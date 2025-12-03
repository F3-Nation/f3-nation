import path from "node:path";
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { config } from "dotenv";
import mysql from "mysql2/promise";

const envFile = process.env.MYSQL_ENV_FILE ?? ".env.local";
const envPath = path.resolve(__dirname, "..", envFile);

config({ path: envPath });
config();

export class FatalError extends Error {}

export interface BeatdownRow {
  ao_id: string;
  bd_date: string | Date;
}

export function parseArgs() {
  const [, , slackUserId, aoChannelId, date] = process.argv;

  if (!slackUserId || !aoChannelId || !date) {
    console.error(
      "Usage: pnpm attendance:remove <slack-user-id> <ao-channel-id> <date>",
    );
    process.exit(1);
  }

  return { slackUserId, aoChannelId, date };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set. Add it to ${envFile} before running the script.`,
    );
    process.exit(1);
  }
  return value;
}

export async function findBeatdown(
  connection: PoolConnection,
  aoChannelId: string,
  date: string,
): Promise<BeatdownRow | null> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
    SELECT ao_id, bd_date
    FROM beatdowns
    WHERE ao_id = ? AND bd_date = ?
    LIMIT 1
    `,
    [aoChannelId, date],
  );

  const row = rows[0] as BeatdownRow | undefined;
  return row ?? null;
}

export async function attendanceExists(
  connection: PoolConnection,
  slackUserId: string,
  aoChannelId: string,
  date: string,
): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
    SELECT 1
    FROM bd_attendance
    WHERE ao_id = ? AND date = ? AND user_id = ?
    LIMIT 1
    `,
    [aoChannelId, date, slackUserId],
  );

  return rows.length > 0;
}

export async function deleteAttendance(
  connection: PoolConnection,
  slackUserId: string,
  aoChannelId: string,
  date: string,
): Promise<number> {
  const [result] = await connection.execute<ResultSetHeader>(
    `
    DELETE FROM bd_attendance
    WHERE ao_id = ? AND date = ? AND user_id = ?
    `,
    [aoChannelId, date, slackUserId],
  );

  return result.affectedRows;
}

export async function main() {
  const { slackUserId, aoChannelId, date } = parseArgs();

  const mysqlUrl = requireEnv("MYSQL_URL");

  const pool = mysql.createPool(mysqlUrl);
  const connection = await pool.getConnection();

  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const beatdown = await findBeatdown(connection, aoChannelId, date);
    if (!beatdown) {
      throw new FatalError(
        `No backblast found for ${aoChannelId} on ${date}; nothing to remove.`,
      );
    }

    const alreadyAttended = await attendanceExists(
      connection,
      slackUserId,
      aoChannelId,
      date,
    );

    if (!alreadyAttended) {
      throw new FatalError(
        `No attendance found for ${slackUserId} at ${aoChannelId} on ${date}.`,
      );
    }

    const affectedRows = await deleteAttendance(
      connection,
      slackUserId,
      aoChannelId,
      date,
    );

    await connection.commit();
    transactionStarted = false;

    console.log(
      `Removed attendance for ${slackUserId} at ${aoChannelId} on ${date}. Rows deleted: ${affectedRows}`,
    );
  } finally {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch {
        // ignore rollback errors when unwinding
      }
    }

    connection.release();
    await pool.end();
  }
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    if (error instanceof FatalError) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}

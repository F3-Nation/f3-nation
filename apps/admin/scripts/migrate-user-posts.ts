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

export interface Conflict {
  table: string;
  details: string[];
}

export const MIGRATION_MAP = [
  { table: "achievements_awarded", columns: ["pax_id"] },
  { table: "bd_attendance", columns: ["user_id", "q_user_id"] },
  { table: "beatdowns", columns: ["q_user_id", "coq_user_id"] },
  { table: "aos", columns: ["site_q_user_id"] },
  { table: "users", columns: ["user_id"] },
];

export const NOT_TRANSFERRED = [
  "Embedded Slack IDs inside JSON columns (bd_attendance.json, beatdowns.json).",
  "View definitions; they pick up changes automatically once base tables are updated.",
  "Any rows that do not reference the current Slack user ID.",
];

export function parseArgs() {
  const [, , currentSlackUserId, newSlackUserId] = process.argv;

  if (!currentSlackUserId || !newSlackUserId) {
    console.error(
      "Usage: pnpm migrate:user:posts <current-slack-user-id> <new-slack-user-id>",
    );
    process.exit(1);
  }

  return { currentSlackUserId, newSlackUserId };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Add it to ${envFile} before migrating.`);
    process.exit(1);
  }
  return value;
}

export function logPlan(currentSlackUserId: string, newSlackUserId: string) {
  console.log("Migrating Slack user data");
  console.log(`Current Slack user ID: ${currentSlackUserId}`);
  console.log(`New Slack user ID: ${newSlackUserId}`);
  console.log("\nThis script reassigns the following columns:");
  for (const entry of MIGRATION_MAP) {
    console.log(`- ${entry.table}: ${entry.columns.join(", ")}`);
  }
  console.log("\nIt does NOT rewrite:");
  for (const item of NOT_TRANSFERRED) {
    console.log(`- ${item}`);
  }
  console.log("");
}

export async function findBeatdownConflicts(
  connection: PoolConnection,
  currentSlackUserId: string,
  newSlackUserId: string,
): Promise<Conflict | null> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
    SELECT old.ao_id, old.bd_date
    FROM beatdowns AS old
    JOIN beatdowns AS conflict
      ON conflict.ao_id = old.ao_id
     AND conflict.bd_date = old.bd_date
     AND conflict.q_user_id = ?
    WHERE old.q_user_id = ?
    `,
    [newSlackUserId, currentSlackUserId],
  );

  if (!rows.length) return null;

  const details = rows.slice(0, 10).map((row) => {
    return `ao_id=${row.ao_id}, bd_date=${row.bd_date}`;
  });

  if (rows.length > details.length) {
    details.push(
      `...and ${rows.length - details.length} more potential conflicts`,
    );
  }

  return {
    table: "beatdowns",
    details,
  };
}

export async function findAttendanceConflicts(
  connection: PoolConnection,
  currentSlackUserId: string,
  newSlackUserId: string,
): Promise<Conflict | null> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
    SELECT
      old.ao_id,
      old.date,
      CASE WHEN old.user_id = ? THEN ? ELSE old.user_id END AS target_user_id,
      CASE WHEN old.q_user_id = ? THEN ? ELSE old.q_user_id END AS target_q_user_id
    FROM bd_attendance AS old
    JOIN bd_attendance AS conflict
      ON conflict.ao_id = old.ao_id
     AND conflict.date = old.date
     AND conflict.user_id = CASE WHEN old.user_id = ? THEN ? ELSE old.user_id END
     AND conflict.q_user_id = CASE WHEN old.q_user_id = ? THEN ? ELSE old.q_user_id END
    WHERE (old.user_id = ? OR old.q_user_id = ?)
      AND (conflict.user_id != old.user_id OR conflict.q_user_id != old.q_user_id)
    `,
    [
      currentSlackUserId,
      newSlackUserId,
      currentSlackUserId,
      newSlackUserId,
      currentSlackUserId,
      newSlackUserId,
      currentSlackUserId,
      newSlackUserId,
      currentSlackUserId,
      currentSlackUserId,
    ],
  );

  if (!rows.length) return null;

  const details = rows.slice(0, 10).map((row) => {
    return `ao_id=${row.ao_id}, date=${row.date}, user_id=${row.target_user_id}, q_user_id=${row.target_q_user_id}`;
  });

  if (rows.length > details.length) {
    details.push(
      `...and ${rows.length - details.length} more potential conflicts`,
    );
  }

  return {
    table: "bd_attendance",
    details,
  };
}

export async function migrateUsersRow(
  connection: PoolConnection,
  currentSlackUserId: string,
  newSlackUserId: string,
): Promise<string> {
  const [users] = await connection.query<RowDataPacket[]>(
    "SELECT user_id FROM users WHERE user_id IN (?, ?)",
    [currentSlackUserId, newSlackUserId],
  );

  const hasCurrent = users.some((row) => row.user_id === currentSlackUserId);
  const hasNew = users.some((row) => row.user_id === newSlackUserId);

  if (hasCurrent && !hasNew) {
    const [result] = await connection.execute<ResultSetHeader>(
      "UPDATE users SET user_id = ? WHERE user_id = ?",
      [newSlackUserId, currentSlackUserId],
    );

    return result.affectedRows
      ? "Renamed users.user_id from current to new."
      : "Attempted to rename users.user_id but no rows were updated.";
  }

  if (hasCurrent && hasNew) {
    return "Both Slack user IDs exist in users; leaving rows untouched.";
  }

  if (!hasCurrent && hasNew) {
    return "No users row for the current Slack ID; assuming the new Slack ID already exists.";
  }

  return "No users rows found for either Slack ID; users table unchanged.";
}

export async function main() {
  const { currentSlackUserId, newSlackUserId } = parseArgs();

  if (currentSlackUserId === newSlackUserId) {
    console.error("Current and new Slack user IDs must be different.");
    process.exit(1);
  }

  const mysqlUrl = requireEnv("MYSQL_URL");
  logPlan(currentSlackUserId, newSlackUserId);

  const pool = mysql.createPool(mysqlUrl);
  const connection = await pool.getConnection();

  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const conflicts: Conflict[] = [];
    const beatdownConflicts = await findBeatdownConflicts(
      connection,
      currentSlackUserId,
      newSlackUserId,
    );
    if (beatdownConflicts) conflicts.push(beatdownConflicts);

    const attendanceConflicts = await findAttendanceConflicts(
      connection,
      currentSlackUserId,
      newSlackUserId,
    );
    if (attendanceConflicts) conflicts.push(attendanceConflicts);

    if (conflicts.length) {
      console.error(
        "Migration aborted because the updates would create duplicate rows:",
      );
      for (const conflict of conflicts) {
        console.error(`- ${conflict.table}:`);
        conflict.details.forEach((detail) => console.error(`  • ${detail}`));
      }
      console.error(
        "Resolve the conflicts (e.g. delete or merge the target rows) and rerun the script.",
      );
      await connection.rollback();
      return;
    }

    const [achievementsResult] = await connection.execute<ResultSetHeader>(
      "UPDATE achievements_awarded SET pax_id = ? WHERE pax_id = ?",
      [newSlackUserId, currentSlackUserId],
    );

    const [attendanceResult] = await connection.execute<ResultSetHeader>(
      `
      UPDATE bd_attendance
      SET
        user_id = CASE WHEN user_id = ? THEN ? ELSE user_id END,
        q_user_id = CASE WHEN q_user_id = ? THEN ? ELSE q_user_id END
      WHERE user_id = ? OR q_user_id = ?
      `,
      [
        currentSlackUserId,
        newSlackUserId,
        currentSlackUserId,
        newSlackUserId,
        currentSlackUserId,
        currentSlackUserId,
      ],
    );

    const [beatdownResult] = await connection.execute<ResultSetHeader>(
      `
      UPDATE beatdowns
      SET
        q_user_id = CASE WHEN q_user_id = ? THEN ? ELSE q_user_id END,
        coq_user_id = CASE WHEN coq_user_id = ? THEN ? ELSE coq_user_id END
      WHERE q_user_id = ? OR coq_user_id = ?
      `,
      [
        currentSlackUserId,
        newSlackUserId,
        currentSlackUserId,
        newSlackUserId,
        currentSlackUserId,
        currentSlackUserId,
      ],
    );

    const [aosResult] = await connection.execute<ResultSetHeader>(
      "UPDATE aos SET site_q_user_id = ? WHERE site_q_user_id = ?",
      [newSlackUserId, currentSlackUserId],
    );

    const usersMessage = await migrateUsersRow(
      connection,
      currentSlackUserId,
      newSlackUserId,
    );

    await connection.commit();
    transactionStarted = false;

    console.log("Migration complete:");
    console.log(
      `- achievements_awarded.pax_id updated: ${achievementsResult.affectedRows}`,
    );
    console.log(
      `- bd_attendance user_id/q_user_id updated: ${attendanceResult.affectedRows}`,
    );
    console.log(
      `- beatdowns q_user_id/coq_user_id updated: ${beatdownResult.affectedRows}`,
    );
    console.log(`- aos.site_q_user_id updated: ${aosResult.affectedRows}`);
    console.log(`- users: ${usersMessage}`);
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
    console.error(error);
    process.exit(1);
  });
}

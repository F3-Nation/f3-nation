import path from "node:path";
import { config } from "dotenv";
import mysql from "mysql2/promise";

const envFile = process.env.MYSQL_ENV_FILE ?? ".env.local";
const envPath = path.resolve(__dirname, "..", envFile);

config({ path: envPath });
config();

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    fail(`${name} is not set. Add it to ${envFile} before migrating.`);
  }
  return value;
}

export function ensureLocalMysqlUrl(url: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`MYSQL_URL is not a valid URL: ${message}`);
  }

  if (parsed.protocol !== "mysql:") {
    fail(`MYSQL_URL must use the mysql protocol. Received: ${parsed.protocol}`);
  }

  const allowedHosts = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "host.docker.internal",
  ]);

  if (!allowedHosts.has(parsed.hostname)) {
    fail(
      `MYSQL_URL must point to a local MySQL instance. Refusing to migrate ${parsed.hostname}.`,
    );
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    fail("MYSQL_URL must include a database name.");
  }

  if (!/^[\w-]+$/.test(database)) {
    fail(
      "MYSQL_URL database name must contain only letters, numbers, underscores, or dashes.",
    );
  }

  return parsed;
}

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForMysql(rootUrl: URL) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const connection = await mysql.createConnection(rootUrl.toString());
      await connection.ping();
      await connection.end();
      return;
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }

  throw lastError;
}

export async function ensureLocalPrivileges(mysqlUrl: URL) {
  const database = mysqlUrl.pathname.replace(/^\//, "");
  const user = mysqlUrl.username;
  const password = mysqlUrl.password;

  if (!user || !password) {
    fail("MYSQL_URL must include both username and password.");
  }

  const rootPassword = process.env.MYSQL_ROOT_PASSWORD ?? "local-root-password";

  const rootUrl = new URL(mysqlUrl.toString());
  rootUrl.username = "root";
  rootUrl.password = rootPassword;
  rootUrl.pathname = "/mysql";

  const safeDbName = database.replace(/`/g, "``");
  const userEscaped = mysql.escape(user);
  const hostEscaped = mysql.escape("%");
  const passwordEscaped = mysql.escape(password);

  await waitForMysql(rootUrl);

  const connection = await mysql.createConnection(rootUrl.toString());
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${safeDbName}\``);
    await connection.query(
      `CREATE USER IF NOT EXISTS ${userEscaped}@${hostEscaped} IDENTIFIED BY ${passwordEscaped}`,
    );
    await connection.query(
      `ALTER USER ${userEscaped}@${hostEscaped} IDENTIFIED BY ${passwordEscaped}`,
    );
    await connection.query(
      `GRANT ALL PRIVILEGES ON \`${safeDbName}\`.* TO ${userEscaped}@${hostEscaped}`,
    );
    await connection.query("FLUSH PRIVILEGES");
  } finally {
    await connection.end();
  }
}

async function main() {
  const mysqlUrl = requireEnv("MYSQL_URL");
  const parsed = ensureLocalMysqlUrl(mysqlUrl);

  await ensureLocalPrivileges(parsed);
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

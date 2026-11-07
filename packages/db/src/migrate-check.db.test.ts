import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { migrateCheck, Reported } from "./migrate-check";

// Runs the real check against the test database's server when its login is a
// superuser (CI's postgres service, the local Docker database); skipped
// otherwise. It creates its own database and roles there, never touching
// the test database.
/** A superuser URL on the test database's server, if its login is one. */
async function findAdminUrl(): Promise<string | undefined> {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) return undefined;
  const url = new URL(testUrl);
  url.pathname = "/postgres";
  const sql = postgres(url.toString(), {
    max: 1,
    connect_timeout: 5,
    onnotice: () => undefined,
  });
  try {
    const [me] = await sql<{ rolsuper: boolean }[]>`
      SELECT rolsuper FROM pg_roles WHERE rolname = current_user`;
    return me?.rolsuper ? url.toString() : undefined;
  } catch {
    return undefined;
  } finally {
    await sql.end();
  }
}

const adminUrl = await findAdminUrl();
/** Only called inside the suite, which is skipped without a superuser. */
const admin = () => adminUrl ?? "";

const drizzleDir = path.resolve(__dirname, "../drizzle");
let dir: string;
let migrations: string;
let fixture: string;
const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
vi.spyOn(console, "error").mockImplementation(() => undefined);

afterAll(() => {
  vi.restoreAllMocks();
});

/** A copy of the migrations plus one throwaway migration, and a fixture. */
function throwaway(sqlText: string, views = "", when = Date.now()) {
  dir = mkdtempSync(path.join(os.tmpdir(), "migrate-check-test-"));
  migrations = path.join(dir, "drizzle");
  cpSync(drizzleDir, migrations, { recursive: true });
  const journalPath = path.join(migrations, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Record<string, unknown>[];
  };
  const last = journal.entries[journal.entries.length - 1] ?? {};
  journal.entries.push({
    ...last,
    idx: journal.entries.length,
    when,
    tag: "9999_throwaway",
  });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(path.join(migrations, "9999_throwaway.sql"), sqlText);
  fixture = path.join(dir, "views.sql");
  writeFileSync(
    fixture,
    readFileSync(path.resolve(__dirname, "../prod-views.sql"), "utf8") + views,
  );
}

afterEach(() => {
  log.mockClear();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const annotations = () =>
  log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("::"));

describe.skipIf(!adminUrl)("migrateCheck", () => {
  it("applies this checkout's migrations", { timeout: 120_000 }, async () => {
    await migrateCheck({ adminUrl: admin(), base: "HEAD" });
    expect(annotations()).toEqual([]);
  });

  it(
    "fails a migration that drops a column a prod view uses",
    { timeout: 120_000 },
    async () => {
      throwaway(
        'SET LOCAL lock_timeout = \'3s\';--> statement-breakpoint\nALTER TABLE "orgs" DROP COLUMN "website";\n',
        "\nCREATE VIEW public.prod_only AS SELECT id, website FROM orgs;\n",
      );
      await expect(
        migrateCheck({
          adminUrl: admin(),
          base: "HEAD",
          migrationsDir: migrations,
          viewsFixture: fixture,
        }),
      ).rejects.toBeInstanceOf(Reported);
      const [error] = annotations();
      expect(error).toMatch(/^::error file=[^,]*9999_throwaway\.sql,line=2,/);
      expect(error).toContain(
        "cannot drop column website of table orgs because other objects depend on it [2BP01]",
      );
      expect(error).toContain(
        'Statement: ALTER TABLE "orgs" DROP COLUMN "website";',
      );
    },
  );

  it(
    "fails a statement only a superuser may run",
    { timeout: 120_000 },
    async () => {
      throwaway("SET session_replication_role = replica;\n");
      await expect(
        migrateCheck({
          adminUrl: admin(),
          base: "HEAD",
          migrationsDir: migrations,
          viewsFixture: fixture,
        }),
      ).rejects.toBeInstanceOf(Reported);
      expect(annotations()[0]).toContain(
        'permission denied to set parameter "session_replication_role" [42501]',
      );
    },
  );

  it(
    "fails a migration Drizzle would skip because its when is too old",
    { timeout: 120_000 },
    async () => {
      throwaway('ALTER TABLE "orgs" ADD COLUMN "x" text;\n', "", 1);
      await expect(
        migrateCheck({
          adminUrl: admin(),
          base: "HEAD",
          migrationsDir: migrations,
          viewsFixture: fixture,
        }),
      ).rejects.toThrow(
        "The branch's journal doesn't apply on top of the base's.",
      );
      expect(annotations()).toEqual([
        expect.stringMatching(
          /^::error::9999_throwaway: its journal "when" \(1\)/,
        ),
      ]);
    },
  );
});

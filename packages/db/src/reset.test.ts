import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppDb } from "./client";
import { DISPOSABLE_MARKER } from "./migrate-guards";

// reset.ts must never reach a real database from here: the db client, URL
// lookup and test-mode flag are all replaced so every path can be driven.
const dbUrl: { databaseUrl: string; databaseName?: string } = {
  databaseUrl: "",
};
const flags = { isTest: true };

vi.mock("./utils/functions", () => ({
  getDb: () => {
    throw new Error("reset must use the caller-supplied db in these tests");
  },
  getDbUrl: () => dbUrl,
}));
vi.mock("@acme/shared/common/constants", () => ({
  get isTest() {
    return flags.isTest;
  },
}));

const { reset } = await import("./reset");

const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL).sql;

interface FakeDbOptions {
  connected?: {
    current_database: string;
    disposable_marker: string | null;
  };
  roles?: string[];
  alembic?: "found" | "missing";
}

// A db whose execute() answers the two read queries from canned data and
// records every statement so the destructive sequence can be asserted.
const fakeDb = ({
  connected = { current_database: "f3nation_test", disposable_marker: null },
  roles = [],
  alembic = "found",
}: FakeDbOptions = {}) => {
  const statements: string[] = [];
  const execute = vi.fn((q: unknown) => {
    const text = render(q);
    statements.push(text);
    if (text.includes("current_database()"))
      return Promise.resolve([connected]);
    if (text.includes("FROM pg_roles")) {
      return Promise.resolve(roles.map((rolname) => ({ rolname })));
    }
    return Promise.resolve([]);
  });
  const from = vi.fn(() =>
    alembic === "found"
      ? Promise.resolve([{ versionNum: "abc123" }])
      : Promise.reject(new Error("relation does not exist")),
  );
  const db = { execute, select: () => ({ from }) } as unknown as AppDb;
  const drops = () =>
    statements
      .filter((s) => s.startsWith("DROP SCHEMA"))
      .map((s) => /DROP SCHEMA IF EXISTS (\w+)/.exec(s)?.[1]);
  return { db, execute, statements, drops };
};

beforeEach(() => {
  flags.isTest = true;
  dbUrl.databaseUrl = "postgresql://u:p@localhost:5432/f3nation_test";
  dbUrl.databaseName = "f3nation_test";
  vi.stubEnv("CI", "");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("reset", () => {
  it("does nothing without a database URL", async () => {
    dbUrl.databaseUrl = "";
    const { db, execute } = fakeDb();
    await reset(db);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does nothing under CI outside test mode", async () => {
    flags.isTest = false;
    vi.stubEnv("CI", "1");
    const { db, execute } = fakeDb();
    await reset(db);
    expect(execute).not.toHaveBeenCalled();
  });

  describe("in test mode", () => {
    it("refuses when the configured database name is not a _test database", async () => {
      dbUrl.databaseUrl = "postgresql://u:p@localhost:5432/f3nation";
      dbUrl.databaseName = "f3nation";
      const { db, drops } = fakeDb({
        connected: { current_database: "f3nation", disposable_marker: null },
      });
      await expect(reset(db)).rejects.toThrow(/Refusing to reset "f3nation"/);
      expect(drops()).toEqual([]);
    });

    it("refuses when the live connection is not the configured _test database", async () => {
      // The URL says _test, but the caller-supplied client is elsewhere.
      const { db, drops } = fakeDb({
        connected: { current_database: "f3nation", disposable_marker: null },
      });
      await expect(reset(db)).rejects.toThrow(/Refusing to reset "f3nation"/);
      expect(drops()).toEqual([]);
    });

    it("drops codex before every other schema, then recreates public", async () => {
      const { db, drops, statements } = fakeDb();
      await reset(db);
      expect(drops()).toEqual([
        "codex",
        "public",
        "drizzle",
        "auth",
        "slackbot",
        "public_history",
        "audit",
      ]);
      const auditDrop = statements.indexOf(
        "DROP SCHEMA IF EXISTS audit CASCADE",
      );
      expect(statements[auditDrop + 1]).toBe("CREATE SCHEMA public");
    });

    it("re-grants public to every non-system role it found before dropping", async () => {
      const { db, statements } = fakeDb({ roles: ["app_api", "app_map"] });
      await reset(db);
      const grants = statements.filter((s) => s.includes("GRANT USAGE"));
      expect(grants).toHaveLength(2);
      expect(grants[0]).toContain('GRANT USAGE ON SCHEMA public TO "app_api"');
      expect(grants[1]).toContain('GRANT USAGE ON SCHEMA public TO "app_map"');
      // The role lookup must precede the drops: it is what the grants replay.
      const rolesAt = statements.findIndex((s) => s.includes("FROM pg_roles"));
      const firstDrop = statements.findIndex((s) =>
        s.startsWith("DROP SCHEMA"),
      );
      expect(rolesAt).toBeGreaterThanOrEqual(0);
      expect(rolesAt).toBeLessThan(firstDrop);
    });

    it("still resets when the alembic version table is absent", async () => {
      const { db, drops } = fakeDb({ alembic: "missing" });
      await reset(db);
      expect(drops()).toContain("public");
    });
  });

  describe("outside test mode (interactive)", () => {
    const LOCAL = "postgresql://u:p@localhost:5432/f3nation";
    const disposable = {
      current_database: "f3nation",
      disposable_marker: DISPOSABLE_MARKER,
    };

    let prompt: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      flags.isTest = false;
      dbUrl.databaseUrl = LOCAL;
      dbUrl.databaseName = "f3nation";
      prompt = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    });

    const answer = (text: string) =>
      vi.spyOn(process.stdin, "once").mockImplementation((_event, listener) => {
        (listener as (data: Buffer) => void)(Buffer.from(`${text}\n`));
        return process.stdin;
      });

    it("refuses a non-loopback host before prompting", async () => {
      dbUrl.databaseUrl = "postgresql://u:p@34.66.1.2:5432/f3nation";
      const { db, drops } = fakeDb({ connected: disposable });
      await expect(reset(db)).rejects.toThrow(/not a verified disposable/);
      expect(prompt).not.toHaveBeenCalled();
      expect(drops()).toEqual([]);
    });

    it("refuses a local database that lacks the disposable marker", async () => {
      const { db, drops } = fakeDb({
        connected: { current_database: "f3nation", disposable_marker: null },
      });
      await expect(reset(db)).rejects.toThrow(/not a verified disposable/);
      expect(drops()).toEqual([]);
    });

    it("refuses when the connection is to a different database than configured", async () => {
      const { db, drops } = fakeDb({
        connected: { ...disposable, current_database: "f3nation_other" },
      });
      await expect(reset(db)).rejects.toThrow(/not a verified disposable/);
      expect(drops()).toEqual([]);
    });

    it("cancels when the operator does not answer y", async () => {
      answer("n");
      const { db, drops } = fakeDb({ connected: disposable });
      await expect(reset(db)).rejects.toThrow("Reset cancelled");
      expect(drops()).toEqual([]);
    });

    it("resets a verified disposable local database after confirmation", async () => {
      answer("y");
      const { db, drops } = fakeDb({ connected: disposable });
      await reset(db);
      expect(prompt).toHaveBeenCalledWith(
        expect.stringContaining("Resetting disposable database f3nation"),
      );
      expect(drops()[0]).toBe("codex");
      expect(drops()).toContain("audit");
    });
  });
});

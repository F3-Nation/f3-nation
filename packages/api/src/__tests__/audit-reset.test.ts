import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  isTest: false,
  databaseUrl: "postgresql://localhost/f3nation",
  databaseName: "f3nation",
}));
vi.mock("@acme/shared/common/constants", () => ({
  get isTest() {
    return state.isTest;
  },
}));
vi.mock("../../../db/src/utils/functions", () => ({
  getDbUrl: () => state,
  getDb: () => {
    throw new Error("unexpected default client");
  },
}));
import { reset } from "../../../db/src/reset";
import type { AppDb } from "@acme/db/client";

function client(name: string, marker: string | null) {
  const statements: string[] = [];
  const execute = vi.fn((query: SQL) => {
    const text = new PgDialect().sqlToQuery(query).sql;
    statements.push(text);
    return Promise.resolve(
      text.includes("current_database()")
        ? [{ current_database: name, disposable_marker: marker }]
        : [],
    );
  });
  const db = {
    execute,
    select: () => ({ from: () => Promise.resolve([]) }),
  } as unknown as AppDb;
  return { db, statements };
}
beforeEach(() => {
  vi.stubEnv("CI", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  state.isTest = false;
  state.databaseUrl = "postgresql://localhost/f3nation";
  state.databaseName = "f3nation";
});

describe("audit reset safety", () => {
  it("skips interactive resets in CI before querying or dropping anything", async () => {
    vi.stubEnv("CI", "1");
    const { db, statements } = client("f3nation", "f3-disposable-local-v1");
    await reset(db);
    expect(statements).toEqual([]);
  });
  it.each([
    ["f3nation", null, "postgresql://localhost/f3nation"],
    ["other", "f3-disposable-local-v1", "postgresql://localhost/f3nation"],
    [
      "f3nation",
      "f3-disposable-local-v1",
      "postgresql://shared.example/f3nation",
    ],
  ])(
    "refuses unverified targets before any schema drops (%s, %s, %s)",
    async (name, marker, url) => {
      state.databaseUrl = url;
      const { db, statements } = client(name, marker);
      await expect(reset(db)).rejects.toThrow("not a verified disposable");
      expect(statements).toHaveLength(1);
      expect(statements.some((s) => s.includes("DROP"))).toBe(false);
    },
  );
  it("allows a marked local reset after confirmation, including both audit schemas", async () => {
    const { db, statements } = client("f3nation", "f3-disposable-local-v1");
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stdin, "once").mockImplementation((event, listener) => {
      if (event === "data") listener(Buffer.from("y"));
      return process.stdin;
    });
    await reset(db);
    expect(
      statements.some((s) =>
        s.includes("DROP SCHEMA IF EXISTS public_history"),
      ),
    ).toBe(true);
    expect(
      statements.some((s) => s.includes("DROP SCHEMA IF EXISTS audit")),
    ).toBe(true);
    expect(write.mock.calls.flat().join("")).not.toContain("postgresql://");
  });
  it("requires the actual test database to match the configured test database", async () => {
    vi.stubEnv("CI", "1");
    state.isTest = true;
    state.databaseName = "fixture_test";
    state.databaseUrl = "postgresql://localhost/fixture_test";
    const wrong = client("other_test", null);
    await expect(reset(wrong.db)).rejects.toThrow("Refusing to reset");
    expect(wrong.statements).toHaveLength(1);
    const correct = client("fixture_test", null);
    await reset(correct.db);
    expect(
      correct.statements.some((s) =>
        s.includes("DROP SCHEMA IF EXISTS public_history"),
      ),
    ).toBe(true);
  });
});

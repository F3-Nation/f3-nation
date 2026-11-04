import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuditDatabase } from "./audit-database";

interface Event {
  kind: "statement" | "close" | "migrate";
  database: string;
  sql?: string;
  identifiers?: string[];
}

const state = vi.hoisted(() => ({
  events: [] as Event[],
  sourceName: "f3nation_test",
  marker: null as string | null,
  targetMismatch: false,
  creationFailure: false,
  migrationFailure: false,
}));

vi.mock("postgres", () => ({
  default: (url: string) => {
    const database = new URL(url).pathname.slice(1);
    const client = Object.assign(
      (strings: TemplateStringsArray | string, ...values: unknown[]) => {
        if (typeof strings === "string") return { identifier: strings };
        const sql = strings.join("?").replace(/\s+/g, " ").trim();
        const identifiers = values.flatMap((value) =>
          typeof value === "object" && value !== null && "identifier" in value
            ? [String(value.identifier)]
            : [],
        );
        state.events.push({ kind: "statement", database, sql, identifiers });
        if (sql.includes("cloudsqlsuperuser"))
          return Promise.resolve([{ cloudsql: false }]);
        if (sql.includes("shobj_description"))
          return Promise.resolve([
            { name: state.sourceName, marker: state.marker },
          ]);
        if (sql.includes("current_database()"))
          return Promise.resolve([
            { name: state.targetMismatch ? "unrelated_test" : database },
          ]);
        if (sql.startsWith("create database") && state.creationFailure)
          return Promise.reject(new Error("creation failed"));
        return Promise.resolve([]);
      },
      {
        database,
        end: () => {
          state.events.push({ kind: "close", database });
          return Promise.resolve();
        },
      },
    );
    return client;
  },
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: (client: { database: string }) => client,
}));
vi.mock("drizzle-orm/postgres-js/migrator", () => ({
  migrate: (client: { database: string }) => {
    state.events.push({ kind: "migrate", database: client.database });
    return state.migrationFailure
      ? Promise.reject(new Error("migration failed"))
      : Promise.resolve();
  },
}));

beforeEach(() => {
  state.events = [];
  state.sourceName = "f3nation_test";
  state.marker = "f3-disposable-local-v1";
  state.targetMismatch = false;
  state.creationFailure = false;
  state.migrationFailure = false;
  vi.stubEnv(
    "TEST_DATABASE_URL",
    "postgresql://local:local@localhost:5432/f3nation_test",
  );
  vi.stubEnv("CI", "");
});
afterEach(() => vi.unstubAllEnvs());

const writes = () =>
  state.events.filter((event) =>
    /^(create|drop) database/.test(event.sql ?? ""),
  );
const closes = () =>
  state.events
    .filter((event) => event.kind === "close")
    .map((event) => event.database);

describe("audit test database ownership", () => {
  it("refuses missing configuration without connecting", async () => {
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    await expect(createAuditDatabase()).rejects.toThrow(
      "Audit tests require TEST_DATABASE_URL",
    );
    expect(state.events).toEqual([]);
  });

  it.each([
    { label: "missing marker", name: "f3nation_test", marker: null },
    {
      label: "live name mismatch",
      name: "unrelated_test",
      marker: "f3-disposable-local-v1",
    },
    { label: "unrelated marker", name: "f3nation_test", marker: "other" },
  ])("refuses $label before any create or drop", async ({ name, marker }) => {
    state.sourceName = name;
    state.marker = marker;
    await expect(createAuditDatabase()).rejects.toThrow(
      "verified disposable test database",
    );
    expect(writes()).toEqual([]);
    expect(closes()).toEqual(["postgres", "f3nation_test"]);
  });

  it("refuses a marked source without the test suffix", async () => {
    vi.stubEnv(
      "TEST_DATABASE_URL",
      "postgresql://local:local@localhost:5432/unrelated",
    );
    state.sourceName = "unrelated";
    await expect(createAuditDatabase()).rejects.toThrow(
      "verified disposable test database",
    );
    expect(writes()).toEqual([]);
    expect(closes()).toEqual(["postgres", "unrelated"]);
  });

  it("allows only the exact CI test database without a marker", async () => {
    vi.stubEnv("CI", "true");
    state.marker = null;
    await expect(createAuditDatabase()).rejects.toThrow(
      "verified disposable test database",
    );
    expect(writes()).toEqual([]);
    vi.stubEnv(
      "TEST_DATABASE_URL",
      "postgresql://local:local@localhost:5432/f3_test",
    );
    state.sourceName = "f3_test";
    const owned = await createAuditDatabase();
    await owned.cleanup();
    expect(writes().map((event) => event.sql)).toEqual([
      "create database ?",
      "drop database ?",
    ]);
  });

  it("never drops a name it failed to create", async () => {
    state.creationFailure = true;
    await expect(createAuditDatabase()).rejects.toThrow("creation failed");
    expect(writes().map((event) => event.sql)).toEqual(["create database ?"]);
    expect(closes()).toEqual(["postgres", "f3nation_test", "postgres"]);
  });

  it.each(["migration", "target"])(
    "closes and drops only its own database after %s failure",
    async (failure) => {
      state.migrationFailure = failure === "migration";
      state.targetMismatch = failure === "target";
      await expect(createAuditDatabase()).rejects.toThrow(
        failure === "migration" ? "migration failed" : "target mismatch",
      );
      const mutations = writes();
      expect(mutations.map((event) => event.sql)).toEqual([
        "create database ?",
        "drop database ?",
      ]);
      const name = mutations[0]!.identifiers![0]!;
      expect(name).toMatch(/^f3_audit_[0-9a-f]{32}_test$/);
      expect(mutations[1]!.identifiers).toEqual([name]);
      expect(closes()).toEqual(["postgres", "f3nation_test", name, "postgres"]);
      expect(
        state.events.findIndex(
          (event) => event.kind === "close" && event.database === name,
        ),
      ).toBeLessThan(
        state.events.findIndex((event) => event.sql === "drop database ?"),
      );
    },
  );

  it("migrates the owned database and drops it only once during repeated cleanup", async () => {
    const owned = await createAuditDatabase();
    const name = new URL(owned.url).pathname.slice(1);
    expect(state.events.filter((event) => event.kind === "migrate")).toEqual([
      { kind: "migrate", database: name },
    ]);
    expect(writes().map((event) => event.sql)).toEqual(["create database ?"]);
    await owned.cleanup();
    await owned.cleanup();
    expect(writes().map((event) => event.identifiers)).toEqual([
      [name],
      [name],
    ]);
    expect(writes().map((event) => event.sql)).toEqual([
      "create database ?",
      "drop database ?",
    ]);
  });
});

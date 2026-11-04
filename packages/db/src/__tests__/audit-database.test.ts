import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupAuditResources, createAuditDatabase } from "./audit-database";

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
  dropFailure: false,
  closeFixtureFailure: false,
  closeProbeFailure: false,
  closeAdminFailure: false,
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
        if (sql.startsWith("drop database") && state.dropFailure)
          return Promise.reject(new Error("drop failed"));
        return Promise.resolve([]);
      },
      {
        database,
        end: () => {
          state.events.push({ kind: "close", database });
          if (state.closeProbeFailure && database === "f3nation_test")
            return Promise.reject(new Error("probe close failed"));
          if (state.closeFixtureFailure && database.startsWith("f3_audit_"))
            return Promise.reject(new Error("fixture close failed"));
          if (
            state.closeAdminFailure &&
            database === "postgres" &&
            state.events.some((event) =>
              event.sql?.startsWith("create database"),
            )
          )
            return Promise.reject(new Error("admin close failed"));
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
  state.dropFailure = false;
  state.closeFixtureFailure = false;
  state.closeProbeFailure = false;
  state.closeAdminFailure = false;
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
  it.each(["false", "0"])(
    "refuses CI=%s as authorization for an unmarked source",
    async (ci) => {
      vi.stubEnv("CI", ci);
      vi.stubEnv(
        "TEST_DATABASE_URL",
        "postgresql://local:local@localhost:5432/f3_test",
      );
      state.sourceName = "f3_test";
      state.marker = null;
      await expect(createAuditDatabase()).rejects.toThrow(/pnpm local:setup/);
      expect(writes()).toEqual([]);
    },
  );

  it("identifies the fixture configuration in remote target refusals without echoing its URL", async () => {
    vi.stubEnv(
      "TEST_DATABASE_URL",
      "postgresql://private-user:private-password@remote.invalid/private_test",
    );
    await expect(createAuditDatabase()).rejects.toThrow(
      /^Refusing to create an audit-test database: TEST_DATABASE_URL in packages\/db\/.env is not a local database\. Run pnpm local:setup/,
    );
    expect(state.events).toEqual([]);
  });

  it("retains a source refusal when closing the probe also fails", async () => {
    state.marker = null;
    state.closeProbeFailure = true;
    const error: unknown = await createAuditDatabase().catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toHaveProperty("errors.length", 2);
    expect(error).toHaveProperty(
      "errors.0.message",
      expect.stringContaining("disposable marker is missing or unrecognized"),
    );
    expect(error).toHaveProperty("errors.1", new Error("probe close failed"));
    expect(writes()).toEqual([]);
    expect(closes()).toEqual(["postgres", "f3nation_test"]);
  });

  it("retains setup and drop failures and still closes the admin", async () => {
    state.migrationFailure = true;
    state.dropFailure = true;
    await expect(createAuditDatabase()).rejects.toMatchObject({
      errors: [new Error("migration failed"), new Error("drop failed")],
    });
    const name = writes()[0]!.identifiers![0]!;
    expect(writes().map((event) => event.identifiers)).toEqual([
      [name],
      [name],
    ]);
    expect(closes()).toEqual(["postgres", "f3nation_test", name, "postgres"]);
    expect(state.events.at(-1)).toEqual({
      kind: "close",
      database: "postgres",
    });
  });

  it("retains migration and client-close failures before attempting owned drop", async () => {
    state.migrationFailure = true;
    state.closeFixtureFailure = true;
    await expect(createAuditDatabase()).rejects.toMatchObject({
      errors: [
        new Error("migration failed"),
        new Error("fixture close failed"),
      ],
    });
    const name = writes()[0]!.identifiers![0]!;
    expect(state.events.slice(-3)).toEqual([
      { kind: "close", database: name },
      {
        kind: "statement",
        database: "postgres",
        sql: "drop database ?",
        identifiers: [name],
      },
      { kind: "close", database: "postgres" },
    ]);
  });

  it("reports both drop and admin-close failures", async () => {
    const owned = await createAuditDatabase();
    state.dropFailure = true;
    state.closeAdminFailure = true;
    await expect(owned.cleanup()).rejects.toMatchObject({
      errors: [new Error("drop failed"), new Error("admin close failed")],
    });
  });

  it("attempts every teardown in dependency order after earlier failures", async () => {
    const order: string[] = [];
    const first = new Error("first close failed");
    const second = new Error("second close failed");
    await expect(
      cleanupAuditResources([
        () => {
          order.push("client");
          return Promise.reject(first);
        },
        () => {
          order.push("production");
          return Promise.reject(second);
        },
        () => {
          order.push("owned database");
          return Promise.resolve();
        },
      ]),
    ).rejects.toMatchObject({ errors: [first, second] });
    expect(order).toEqual(["client", "production", "owned database"]);
  });

  it("refuses missing configuration without connecting", async () => {
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    await expect(createAuditDatabase()).rejects.toThrow(
      /^Audit tests require TEST_DATABASE_URL\. Run pnpm local:setup/,
    );
    expect(state.events).toEqual([]);
  });

  it.each([
    {
      label: "missing marker",
      name: "f3nation_test",
      marker: null,
      reason: "disposable marker is missing or unrecognized",
    },
    {
      label: "live name mismatch",
      name: "unrelated_test",
      marker: "f3-disposable-local-v1",
      reason: "live database does not match TEST_DATABASE_URL",
    },
    {
      label: "unrelated marker",
      name: "f3nation_test",
      marker: "other",
      reason: "disposable marker is missing or unrecognized",
    },
  ])(
    "refuses $label before any create or drop",
    async ({ name, marker, reason }) => {
      state.sourceName = name;
      state.marker = marker;
      await expect(createAuditDatabase()).rejects.toThrow(
        `${reason}. Run pnpm local:setup`,
      );
      expect(writes()).toEqual([]);
      expect(closes()).toEqual(["postgres", "f3nation_test"]);
    },
  );

  it("refuses a marked source without the test suffix", async () => {
    vi.stubEnv(
      "TEST_DATABASE_URL",
      "postgresql://local:local@localhost:5432/unrelated",
    );
    state.sourceName = "unrelated";
    await expect(createAuditDatabase()).rejects.toThrow(
      "TEST_DATABASE_URL must name a database ending in _test. Run pnpm local:setup",
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as functions from "./utils/functions";

// migrate.ts's own imports would connect to a database; nothing here may.
const migrator = vi.fn();
const createDatabaseIfNotExists = vi.fn();
const dbUrl = { databaseUrl: "" };

vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate: migrator }));
vi.mock("./client", () => ({ db: {} }));
vi.mock(".", () => ({ sql: vi.fn() }));
vi.mock("./reset", () => ({ reset: vi.fn(), alembicVersionValue: undefined }));
vi.mock("./utils/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof functions>()),
  createDatabaseIfNotExists,
  getDbUrl: () => dbUrl,
}));
// The server lookup: a local, non-Cloud SQL Postgres.
vi.mock("postgres", () => ({
  default: () =>
    Object.assign(() => Promise.resolve([{ cloudsql: false }]), {
      end: () => Promise.resolve(),
    }),
}));

const LOCAL = "postgresql://u:p@localhost:5432/f3nation";

// migrate.ts reads env.DATABASE_URL at import time.
const load = async (databaseUrl: string) => {
  vi.stubEnv("DATABASE_URL", databaseUrl);
  dbUrl.databaseUrl = databaseUrl;
  vi.resetModules();
  return import("./migrate");
};

beforeEach(() => {
  vi.stubEnv("CI", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("migrate", () => {
  it("refuses under CI before touching any database", async () => {
    vi.stubEnv("CI", "1");
    const { migrate } = await load(LOCAL);
    await expect(migrate()).rejects.toThrow(/CI is set/);
    expect(createDatabaseIfNotExists).not.toHaveBeenCalled();
    expect(migrator).not.toHaveBeenCalled();
  });

  it("refuses a remote DATABASE_URL before creating or migrating", async () => {
    const { migrate } = await load("postgresql://u:p@34.66.1.2/f3nation");
    await expect(migrate()).rejects.toThrow(/not a local database/);
    expect(createDatabaseIfNotExists).not.toHaveBeenCalled();
    expect(migrator).not.toHaveBeenCalled();
  });

  it("also checks the URL the migrator's client uses (TEST_DATABASE_URL)", async () => {
    const { migrate } = await load(LOCAL);
    dbUrl.databaseUrl = "postgresql://u:p@34.66.1.2/f3nation_test";
    await expect(migrate()).rejects.toThrow(/not a local database/);
    expect(createDatabaseIfNotExists).not.toHaveBeenCalled();
    expect(migrator).not.toHaveBeenCalled();
  });

  it("migrates a local database", async () => {
    const { migrate } = await load(LOCAL);
    await migrate();
    expect(createDatabaseIfNotExists).toHaveBeenCalledWith(LOCAL);
    expect(migrator).toHaveBeenCalledOnce();
  });
});

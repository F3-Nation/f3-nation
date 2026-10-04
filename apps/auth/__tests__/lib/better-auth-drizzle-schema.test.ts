import { describe, expect, it } from "vitest";
import { schemaCheckFor } from "@better-auth/core/db/internal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";

import {
  allowProductionClientAction,
  betterAuthDrizzleSchema,
  buildBetterAuthOptions,
} from "../../src/lib/better-auth";

// Runs against the real @acme/db tables rather than memoryAdapter, which
// skips both Better Auth's schema check and Drizzle's value mapping. A mock
// Drizzle client is enough: the schema check reads the table objects, not
// the database, and toSQL() shows the params the driver would receive.
const db = drizzle.mock();

describe("Better Auth against the @acme/db Drizzle schema", () => {
  it("passes Better Auth's own schema check", async () => {
    const factory = drizzleAdapter(db, {
      provider: "pg",
      schemaName: "auth",
      schema: betterAuthDrizzleSchema,
    });
    const options = buildBetterAuthOptions({
      baseURL: "http://localhost:3999",
      basePath: "/api/auth2",
      secret: "test-only-not-a-real-secret",
      issuer: "http://localhost:3999/api/auth2",
      database: factory,
      sendVerificationOTP: () => Promise.resolve(),
      findF3UserId: () => Promise.resolve(1),
      isNationAdmin: () => Promise.resolve(false),
      allowClientAction: allowProductionClientAction,
    });
    const check = schemaCheckFor(factory(options));

    expect(check).toBeDefined();
    await expect(check?.()).resolves.toBeUndefined();
  });

  // Better Auth writes Date objects. In Drizzle's "string" mode (what
  // `drizzle-kit pull` emits) the Date reaches postgres-js unconverted and
  // the insert throws ERR_INVALID_ARG_TYPE.
  const timestampColumns = Object.values<PgTable>(
    betterAuthDrizzleSchema,
  ).flatMap((table) =>
    Object.entries(getTableColumns(table))
      .filter(([, column]) => column.getSQLType().startsWith("timestamp"))
      .map(([key, column]) => ({
        label: `${getTableName(table)}.${column.name}`,
        table,
        key,
      })),
  );

  it("has timestamp columns to check", () => {
    expect(timestampColumns.length).toBeGreaterThan(0);
  });

  it.each(timestampColumns)(
    "serializes a Date written to $label",
    ({ table, key }) => {
      const { params } = db
        .insert(table)
        .values({ [key]: new Date() } as never)
        .toSQL();

      expect(params.some((param) => param instanceof Date)).toBe(false);
    },
  );
});

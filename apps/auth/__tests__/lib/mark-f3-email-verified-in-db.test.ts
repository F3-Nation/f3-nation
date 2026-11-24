import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { and, eq, isNull } from "@acme/db";
import { users } from "@acme/db/schema/schema";

import { markF3EmailVerifiedInDb } from "../../src/lib/better-auth";

// Fakes only the chained query-builder shape markF3EmailVerifiedInDb calls;
// see is-nation-admin-for-user.test.ts for why this isn't a live-Postgres test.
function fakeDb() {
  const query = {
    update: vi.fn((_table: unknown) => query),
    set: vi.fn((_values: unknown) => query),
    where: vi.fn((_condition?: SQL) => Promise.resolve([])),
  };
  return query;
}

const toQuery = (s: SQL | undefined) => new PgDialect().sqlToQuery(s!);
const NOW = "2026-11-12T12:00:00.000Z";

describe("markF3EmailVerifiedInDb", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets emailVerified only for that user, still at that email, while unset", async () => {
    vi.useFakeTimers({ now: new Date(NOW) });
    const db = fakeDb();

    await markF3EmailVerifiedInDb(
      db as unknown as Parameters<typeof markF3EmailVerifiedInDb>[0],
    )(7, "  T@F3Nation.Test ");

    expect(db.update).toHaveBeenCalledExactlyOnceWith(users);
    expect(db.set).toHaveBeenCalledExactlyOnceWith({ emailVerified: NOW });
    expect(toQuery(db.where.mock.calls[0]?.[0])).toEqual(
      toQuery(
        and(
          eq(users.id, 7),
          eq(users.email, "t@f3nation.test"),
          isNull(users.emailVerified),
        ),
      ),
    );
  });
});

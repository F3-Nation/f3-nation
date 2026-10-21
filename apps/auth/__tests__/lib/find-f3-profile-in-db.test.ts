import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { eq } from "@acme/db";
import { users } from "@acme/db/schema/schema";

import { findF3ProfileInDb } from "../../src/lib/better-auth";

// Fakes only the chained query-builder shape findF3ProfileInDb calls; see
// is-nation-admin-for-user.test.ts for why this isn't a live-Postgres test.
function fakeQuery(rows: Record<string, unknown>[]) {
  const query = {
    select: vi.fn(() => query),
    from: vi.fn(() => query),
    where: vi.fn((_condition?: unknown) => query),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return query;
}

function fakeDb(rows: Record<string, unknown>[]) {
  return fakeQuery(rows) as unknown as Parameters<typeof findF3ProfileInDb>[0];
}

const row = {
  f3Name: "Tackle",
  avatarUrl: "https://cdn.example.com/t.png",
  email: "t@f3nation.test",
  emailVerified: "2026-01-01 00:00:00",
  meta: { onboarding_completed: true },
};

describe("findF3ProfileInDb", () => {
  it("maps the users row", async () => {
    await expect(findF3ProfileInDb(fakeDb([row]), 7)).resolves.toEqual({
      f3Name: "Tackle",
      avatarUrl: "https://cdn.example.com/t.png",
      email: "t@f3nation.test",
      emailVerified: true,
      onboardingCompleted: true,
    });
  });

  it("reads onboarding as not completed when meta is unset or lacks the flag", async () => {
    for (const meta of [null, {}, { onboarding_completed: false }]) {
      const profile = await findF3ProfileInDb(
        fakeDb([{ ...row, meta, emailVerified: null }]),
        7,
      );
      expect(profile).toMatchObject({
        onboardingCompleted: false,
        emailVerified: false,
      });
    }
  });

  it("selects the row for the given id and no other", async () => {
    const toQuery = (s: SQL | undefined) => new PgDialect().sqlToQuery(s!);
    for (const id of [7, 8]) {
      const query = fakeQuery([row]);
      await findF3ProfileInDb(
        query as unknown as Parameters<typeof findF3ProfileInDb>[0],
        id,
      );
      expect(toQuery(query.where.mock.calls[0]?.[0] as SQL)).toEqual(
        toQuery(eq(users.id, id)),
      );
      expect(query.limit).toHaveBeenCalledWith(1);
    }
  });

  it("returns null when there is no users row", async () => {
    await expect(findF3ProfileInDb(fakeDb([]), 7)).resolves.toBeNull();
  });
});

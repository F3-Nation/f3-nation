import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MDPGDrizzleAdapter } from "@acme/auth/lib/md-pg-drizzzle-adapter";
import { eq, inArray, schema } from "@acme/db";
import { createDbClient } from "@acme/db/testing";

// Use the API suite's migrated PostgreSQL database to exercise atomic claims.
const { db, close } = createDbClient();
const adapter = MDPGDrizzleAdapter(db);
const identifiers = [
  "token-test@example.test",
  "other-token-test@example.test",
];
const identifier = identifiers[0]!;
const token = "synthetic-verification-token";
const expires = new Date("2099-01-01T00:00:00.000Z");
const input = { identifier, token };

const clearTokens = () =>
  db
    .delete(schema.authVerificationTokens)
    .where(inArray(schema.authVerificationTokens.identifier, identifiers));
const seed = (overrides: Partial<typeof input & { expires: Date }> = {}) =>
  adapter.createVerificationToken!({ ...input, expires, ...overrides });

beforeEach(async () => {
  await clearTokens();
});
afterAll(async () => {
  await clearTokens();
  await close();
});

describe("verification token consumption", () => {
  it("returns the token once and rejects replay", async () => {
    await seed();
    const first = await adapter.useVerificationToken!(input);
    expect(first).toMatchObject(input);
    expect(first?.expires).toBeInstanceOf(Date);
    expect(await adapter.useVerificationToken!(input)).toBeNull();
    expect(
      await db
        .select()
        .from(schema.authVerificationTokens)
        .where(eq(schema.authVerificationTokens.identifier, identifier)),
    ).toEqual([]);
  });

  it("allows only one concurrent claimant", async () => {
    await seed();
    const results = await Promise.all(
      Array.from(
        { length: 8 },
        async () => await adapter.useVerificationToken!(input),
      ),
    );
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(7);
  });

  it("returns null for a missing token", async () => {
    expect(await adapter.useVerificationToken!(input)).toBeNull();
  });

  it("does not consume tokens for a wrong token or identifier", async () => {
    await seed();
    expect(
      await adapter.useVerificationToken!({
        ...input,
        token: "x".repeat(token.length),
      }),
    ).toBeNull();
    expect(
      await adapter.useVerificationToken!({
        ...input,
        identifier: identifiers[1]!,
      }),
    ).toBeNull();
    expect(await adapter.useVerificationToken!(input)).toMatchObject(input);
  });

  it("normalizes the identifier and preserves other tokens", async () => {
    await seed();
    await seed({ token: "another-synthetic-token" });
    await seed({ identifier: identifiers[1]! });
    expect(
      await adapter.useVerificationToken!({
        ...input,
        identifier: "  TOKEN-TEST@EXAMPLE.TEST  ",
      }),
    ).toMatchObject(input);
    expect(
      await adapter.useVerificationToken!({
        ...input,
        token: "another-synthetic-token",
      }),
    ).not.toBeNull();
    expect(
      await adapter.useVerificationToken!({
        ...input,
        identifier: identifiers[1]!,
      }),
    ).not.toBeNull();
  });

  it("returns an expired token's date for Auth.js to reject, then consumes it", async () => {
    const expired = new Date("2000-01-01T00:00:00.000Z");
    await seed({ expires: expired });
    const result = await adapter.useVerificationToken!(input);
    expect(result?.expires).toBeInstanceOf(Date);
    expect(result!.expires.valueOf()).toBeLessThan(Date.now());
    expect(await adapter.useVerificationToken!(input)).toBeNull();
  });

  it("rejects database failures without exposing query parameters", async () => {
    const failure = vi.spyOn(db, "delete").mockImplementationOnce(() => {
      throw new Error("query includes sensitive-token-value");
    });
    try {
      await expect(adapter.useVerificationToken!(input)).rejects.toThrow(
        "Unable to consume verification token.",
      );
    } finally {
      failure.mockRestore();
    }
  });
});

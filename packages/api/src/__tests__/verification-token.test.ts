import { createHash, randomUUID } from "node:crypto";
import type { AuthConfig } from "@auth/core";
import { Auth } from "@auth/core";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  limitVerificationEmails,
  MDPGDrizzleAdapter,
  reserveVerificationSend,
} from "@acme/auth/lib/md-pg-drizzzle-adapter";
import { eq, inArray, schema, sql } from "@acme/db";
import { createDbClient } from "@acme/db/testing";

// Use the API suite's migrated PostgreSQL database to exercise atomic claims.
const { db, close } = createDbClient();
const adapter = MDPGDrizzleAdapter(db);
let identifiers: [string, string];
let identifier: string;
const token = "synthetic-verification-token";
let expires: Date;
let input: { identifier: string; token: string };

const clearTokens = async () => {
  await db
    .delete(schema.authVerificationTokens)
    .where(inArray(schema.authVerificationTokens.identifier, identifiers));
  await db
    .delete(schema.authVerificationSends)
    .where(inArray(schema.authVerificationSends.identifier, identifiers));
};
const seed = (overrides: Partial<typeof input & { expires: Date }> = {}) =>
  adapter.createVerificationToken!({ ...input, expires, ...overrides });
const readTokens = (forIdentifier = identifier) =>
  db
    .select()
    .from(schema.authVerificationTokens)
    .where(eq(schema.authVerificationTokens.identifier, forIdentifier));
/** Moves every send to the identifier back in time, as if made earlier. */
const age = (interval: string, forIdentifier = identifier) =>
  db
    .update(schema.authVerificationSends)
    .set({
      created: sql`${schema.authVerificationSends.created} - ${interval}::interval`,
    })
    .where(eq(schema.authVerificationSends.identifier, forIdentifier));
const readSends = (forIdentifier = identifier) =>
  db
    .select()
    .from(schema.authVerificationSends)
    .where(eq(schema.authVerificationSends.identifier, forIdentifier));
const isLive = (result: { expires: Date } | null) =>
  result !== null && result.expires.valueOf() > Date.now();

beforeEach(() => {
  const prefix = randomUUID();
  identifiers = [
    `token-${prefix}@example.test`,
    `other-${prefix}@example.test`,
  ];
  identifier = identifiers[0];
  input = { identifier, token };
  expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
});
afterEach(async () => {
  await clearTokens();
});
afterAll(async () => {
  await close();
});

describe("verification token consumption", () => {
  it("returns the token once and rejects replay", async () => {
    await seed();
    const first = await adapter.useVerificationToken!(input);
    expect(first).toMatchObject(input);
    expect(first?.expires).toBeInstanceOf(Date);
    expect(first!.expires.valueOf()).toBeGreaterThan(Date.now());
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

  it("returns the stored expiry unchanged on a host outside UTC", async () => {
    vi.stubEnv("TZ", "America/Chicago");
    try {
      const at = new Date("2030-06-15T12:34:56.789Z");
      await seed({ expires: at });
      const result = await adapter.useVerificationToken!(input);
      expect(result?.expires.toISOString()).toBe(at.toISOString());
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns null for a missing token", async () => {
    expect(await adapter.useVerificationToken!(input)).toBeNull();
  });

  it("leaves the token alone after a guess for another identifier", async () => {
    await seed();
    expect(
      await adapter.useVerificationToken!({
        ...input,
        identifier: identifiers[1],
      }),
    ).toBeNull();
    expect(isLive(await adapter.useVerificationToken!(input))).toBe(true);
  });

  it("finds the token under a differently cased and padded identifier", async () => {
    await seed();
    expect(
      await adapter.useVerificationToken!({
        ...input,
        identifier: `  ${identifier.toUpperCase()}  `,
      }),
    ).toMatchObject(input);
  });

  it("ends the live token after one wrong guess", async () => {
    await seed();
    expect(
      await adapter.useVerificationToken!({
        ...input,
        token: "x".repeat(token.length),
      }),
    ).toBeNull();
    const after = await adapter.useVerificationToken!(input);
    expect(after).toMatchObject(input);
    expect(isLive(after)).toBe(false);
  });

  it("gives parallel guesses one live token to share", async () => {
    await seed();
    const wrong = Array.from(
      { length: 6 },
      async (_, index) =>
        await adapter.useVerificationToken!({
          ...input,
          token: `wrong-guess-${index}`.padEnd(token.length, "x"),
        }),
    );
    await Promise.all(wrong);
    expect(isLive(await adapter.useVerificationToken!(input))).toBe(false);
  });

  it("leaves another identifier's token live after a wrong guess", async () => {
    await seed();
    await seed({ identifier: identifiers[1] });
    await adapter.useVerificationToken!({ ...input, token: "wrong" });
    expect(
      isLive(
        await adapter.useVerificationToken!({
          ...input,
          identifier: identifiers[1],
        }),
      ),
    ).toBe(true);
  });

  it("returns an expired token's date for Auth.js to reject, then consumes it", async () => {
    const expired = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await seed({ expires: expired });
    const result = await adapter.useVerificationToken!(input);
    expect(result?.expires).toBeInstanceOf(Date);
    expect(result!.expires.valueOf()).toBeLessThan(Date.now());
    expect(await adapter.useVerificationToken!(input)).toBeNull();
  });

  it("rejects database failures without exposing query parameters", async () => {
    await seed();
    const failure = vi.spyOn(db, "transaction").mockImplementationOnce(() => {
      throw new Error(`query includes sensitive-token-value for ${identifier}`);
    });
    try {
      const result = await Promise.resolve(
        adapter.useVerificationToken!(input),
      ).catch((error: unknown) => error);
      expect(result).toBeInstanceOf(Error);
      const error = result as Error;
      expect(error.message).toBe("Unable to consume verification token.");
      expect(error.cause).toBeUndefined();
      expect(`${String(error)} ${error.stack}`).not.toContain(
        "sensitive-token-value",
      );
      expect(`${String(error)} ${error.stack}`).not.toContain(identifier);
    } finally {
      failure.mockRestore();
    }
    expect(
      await db
        .select()
        .from(schema.authVerificationTokens)
        .where(eq(schema.authVerificationTokens.identifier, identifier)),
    ).toHaveLength(1);
  });
});

describe("verification token sends", () => {
  it("keeps only the newest token live", async () => {
    await seed();
    await seed({ token: "newer-synthetic-token" });

    expect(isLive(await adapter.useVerificationToken!(input))).toBe(false);
    expect(
      isLive(
        await adapter.useVerificationToken!({
          ...input,
          token: "newer-synthetic-token",
        }),
      ),
    ).toBe(true);
  });

  it("drops the address's expired tokens when it stores a new one", async () => {
    await seed({ expires: new Date(Date.now() - 1000) });
    await seed({ token: "newer-synthetic-token" });

    expect((await readTokens()).map((row) => row.token)).toEqual([
      "newer-synthetic-token",
    ]);
  });
});

describe("verification send limit", () => {
  it("allows five sends an hour and refuses the sixth, recording nothing", async () => {
    for (let sent = 1; sent <= 5; sent++) {
      expect(await reserveVerificationSend(db, identifier)).toBe(true);
      await age("1 minute");
    }

    expect(await reserveVerificationSend(db, identifier)).toBe(false);
    expect(await readSends()).toHaveLength(5);
  });

  it("refuses a second send within 30 seconds and allows one after", async () => {
    expect(await reserveVerificationSend(db, identifier)).toBe(true);
    expect(await reserveVerificationSend(db, identifier)).toBe(false);

    await age("31 seconds");

    expect(await reserveVerificationSend(db, identifier)).toBe(true);
  });

  it("counts the normalized address", async () => {
    expect(await reserveVerificationSend(db, identifier)).toBe(true);
    expect(
      await reserveVerificationSend(db, `  ${identifier.toUpperCase()} `),
    ).toBe(false);
  });

  it("counts each address separately", async () => {
    expect(await reserveVerificationSend(db, identifier)).toBe(true);
    expect(await reserveVerificationSend(db, identifiers[1])).toBe(true);
  });

  it("forgets sends made more than an hour ago", async () => {
    for (let sent = 1; sent <= 5; sent++) {
      await reserveVerificationSend(db, identifier);
      await age("1 minute");
    }
    await age("1 hour");

    expect(await reserveVerificationSend(db, identifier)).toBe(true);
    expect(await readSends()).toHaveLength(1);
  });

  it("lets only one of several parallel sends through", async () => {
    const results = await Promise.all(
      Array.from(
        { length: 6 },
        async () => await reserveVerificationSend(db, identifier),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await readSends()).toHaveLength(1);
  });
});

describe("sign-in email requests through Auth.js", () => {
  const secret = "synthetic-auth-secret";
  const base = "http://localhost/api/auth";
  const transport = vi.fn<(params: { token: string }) => Promise<void>>();
  const config: AuthConfig = {
    adapter: MDPGDrizzleAdapter(db) as AuthConfig["adapter"],
    secret,
    trustHost: true,
    basePath: "/api/auth",
    providers: [
      {
        id: "email",
        name: "Email",
        type: "email",
        maxAge: 5 * 60,
        options: {},
        sendVerificationRequest: transport,
      },
    ],
    callbacks: { signIn: limitVerificationEmails(db) },
  };

  /** Requests a sign-in email and returns where Auth.js redirects. */
  const requestEmail = async (email = identifier) => {
    const csrf = await Auth(new Request(`${base}/csrf`), config);
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };
    const cookie = csrf.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const response = await Auth(
      new Request(`${base}/signin/email`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie,
        },
        body: new URLSearchParams({ email, csrfToken }),
      }),
      config,
    );
    return response.headers.get("location") ?? "";
  };
  /** The adapter stores Auth.js's hash of the emailed token. */
  const sentToken = (call: number) =>
    createHash("sha256")
      .update(`${transport.mock.calls[call]![0].token}${secret}`)
      .digest("hex");
  const redeem = (call: number) =>
    adapter.useVerificationToken!({ identifier, token: sentToken(call) });

  beforeEach(() => {
    transport.mockReset();
    transport.mockResolvedValue(undefined);
  });

  it("emails once for two requests inside the cooldown, leaving the first code usable", async () => {
    expect(await requestEmail()).toContain("/verify-request");
    expect(await requestEmail()).toContain("error=AccessDenied");

    expect(transport).toHaveBeenCalledTimes(1);
    expect(await readTokens()).toHaveLength(1);
    expect(isLive(await redeem(0))).toBe(true);
  });

  it("refuses a send right after the last code was redeemed", async () => {
    await requestEmail();
    expect(isLive(await redeem(0))).toBe(true);

    expect(await requestEmail()).toContain("error=AccessDenied");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("refuses a sixth send in an hour even when every code was redeemed", async () => {
    for (let sent = 0; sent < 5; sent++) {
      expect(await requestEmail()).toContain("/verify-request");
      expect(isLive(await redeem(sent))).toBe(true);
      await age("1 minute");
    }

    expect(await requestEmail()).toContain("error=AccessDenied");
    expect(transport).toHaveBeenCalledTimes(5);
  });
});

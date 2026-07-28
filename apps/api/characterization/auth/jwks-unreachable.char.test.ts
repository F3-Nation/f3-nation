import { afterAll, describe, it } from "vitest";

/**
 * JWKS-outage isolation, in its own file because the JWKS URL is captured at
 * packages/api/src/shared.ts import time. The forks pool gives each file a fresh
 * module registry, so pointing NEXT_PUBLIC_AUTH_URL at a closed port BEFORE the
 * first import of ../transport makes createRemoteJWKSet unreachable for this
 * file only. Port 1 is guaranteed closed.
 */
const realAuthUrl = process.env.NEXT_PUBLIC_AUTH_URL;
process.env.NEXT_PUBLIC_AUTH_URL = "http://127.0.0.1:1";

const { req, target } = await import("../transport");
const { createApiKey } = await import("../fixtures/api-keys");
const { signFixtureJwt } = await import("../fixtures/jwt");
const { createFixtureUser } = await import("../fixtures/users");
const { expectAuthorized, expectUnauthorized } = await import("./verdict");

const IP = (n: number) => `10.67.0.${n}`;

describe.runIf(target.inProcess)("JWKS outage isolation", () => {
  afterAll(() => {
    // Assigning an undefined back would leave the literal string "undefined".
    if (realAuthUrl === undefined) {
      delete process.env.NEXT_PUBLIC_AUTH_URL;
    } else {
      process.env.NEXT_PUBLIC_AUTH_URL = realAuthUrl;
    }
  });

  it("fails a JWT closed when the JWKS is unreachable", async () => {
    const user = await createFixtureUser({ roles: [{ roleName: "admin" }] });
    try {
      const token = await signFixtureJwt({
        sub: user.userId,
        // Match the (unreachable) issuer shared.ts captured at import time, so
        // a failed JWKS fetch is the ONLY ground this can fail on. Signing with
        // the real issuer would also fail the issuer check — already pinned in
        // jwt.char.test.ts — and would mask a broken isolation as green.
        issuer: process.env.NEXT_PUBLIC_AUTH_URL,
      });
      await expectUnauthorized(
        await target.invoke(
          req("/v1/api-key", {
            headers: {
              "x-forwarded-for": IP(1),
              authorization: `Bearer ${token}`,
              client: "characterization",
            },
          }),
        ),
        "Unauthorized",
      );
    } finally {
      await user.cleanup();
    }
  });

  // Not a JWKS-outage case despite the file: `char-key-<id>` is not a compact
  // JWS, so jwtVerify throws at parse before reaching the remote key resolver.
  // Kept as a fall-through guard, under a name that does not overclaim.
  it("falls through to API-key auth for a non-JWT bearer", async () => {
    const key = await createApiKey({ roles: [{ roleName: "admin" }] });
    try {
      await expectAuthorized(
        await target.invoke(
          req("/v1/api-key", {
            headers: {
              "x-forwarded-for": IP(2),
              authorization: `Bearer ${key.key}`,
              client: "characterization",
            },
          }),
        ),
      );
    } finally {
      await key.cleanup();
    }
  });
});

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
    process.env.NEXT_PUBLIC_AUTH_URL = realAuthUrl;
  });

  it("fails a JWT closed when the JWKS is unreachable", async () => {
    const user = await createFixtureUser({ roles: [{ roleName: "admin" }] });
    try {
      const token = await signFixtureJwt({
        sub: user.userId,
        // The signer still uses the real issuer; verification can't reach it.
        issuer: realAuthUrl,
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

  it("still authorizes an API key while the JWKS is down", async () => {
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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeJwt, decodeProtectedHeader } from "jose";

import { FIXTURE_KID } from "../global-setup";
import {
  generateForeignKey,
  signFixtureIdToken,
  signFixtureJwt,
} from "../fixtures/jwt";
import { createFixtureUser } from "../fixtures/users";
import { req, target } from "../transport";
import { expectAuthorized, expectUnauthorized } from "./verdict";

/**
 * RS256 JWT resolution through the real remote-JWKS path. A valid token for a
 * seeded user authorizes; the failure modes all fall through to a 401 (or, when
 * a bearer is present, whatever the API-key fallback yields). `/v1/api-key` is
 * adminProcedure, and the fixture user carries an admin DB role.
 */

const IP = (n: number) => `10.66.0.${n}`;

function jwtReq(ip: number, token: string): Request {
  return req("/v1/api-key", {
    headers: {
      "x-forwarded-for": IP(ip),
      authorization: `Bearer ${token}`,
      client: "characterization",
    },
  });
}

describe.runIf(target.inProcess)("JWT resolution", () => {
  let user: Awaited<ReturnType<typeof createFixtureUser>>;

  beforeAll(async () => {
    user = await createFixtureUser({ roles: [{ roleName: "admin" }] });
  });

  afterAll(async () => {
    await user.cleanup();
  });

  it("authorizes a valid token and fetches DB roles", async () => {
    const token = await signFixtureJwt({ sub: user.userId });
    await expectAuthorized(await target.invoke(jwtReq(1, token)));
  });

  it("rejects an expired token", async () => {
    const token = await signFixtureJwt({
      sub: user.userId,
      expiresInSeconds: -60,
    });
    await expectUnauthorized(
      await target.invoke(jwtReq(2, token)),
      "Unauthorized",
    );
  });

  it("rejects a wrong-issuer token", async () => {
    const token = await signFixtureJwt({
      sub: user.userId,
      issuer: "https://evil.example.com",
    });
    await expectUnauthorized(
      await target.invoke(jwtReq(3, token)),
      "Unauthorized",
    );
  });

  it("rejects a bad-signature token (foreign key)", async () => {
    const token = await signFixtureJwt({
      sub: user.userId,
      key: await generateForeignKey(),
    });
    await expectUnauthorized(
      await target.invoke(jwtReq(4, token)),
      "Unauthorized",
    );
  });

  it("rejects a valid signature for an unknown sub", async () => {
    const token = await signFixtureJwt({ sub: 2_000_000_000 });
    await expectUnauthorized(
      await target.invoke(jwtReq(5, token)),
      "Unauthorized",
    );
  });

  it("rejects an ID Token used as a bearer credential", async () => {
    // Same signing key, kid, and issuer as a real access token — only
    // token_use differs. Without the token_use check in getSessionFromJWT,
    // this would authorize just like a real access token does above.
    const token = await signFixtureIdToken({ sub: user.userId });
    await expectUnauthorized(
      await target.invoke(jwtReq(6, token)),
      "Unauthorized",
    );
  });
});

// The other half of the producer/mirror drift guard: apps/auth's own test pins
// signAccessToken's output, this pins the fixture that imitates it. Both must
// change together or one of the two goes red.
describe("fixture token shape", () => {
  it("mirrors the claim set signAccessToken emits", async () => {
    const token = await signFixtureJwt({ sub: 4242 });

    expect(Object.keys(decodeJwt(token)).sort()).toEqual([
      "client_id",
      "email",
      "exp",
      "iat",
      "iss",
      "scope",
      "sub",
      "token_use",
    ]);
  });

  it("stamps the RS256 header the API resolves keys by", async () => {
    const token = await signFixtureJwt({ sub: 4242 });

    expect(decodeProtectedHeader(token)).toEqual({
      alg: "RS256",
      kid: FIXTURE_KID,
    });
  });

  it("serializes sub as a numeric string", async () => {
    const token = await signFixtureJwt({ sub: Number.MAX_SAFE_INTEGER });

    expect(decodeJwt(token).sub).toBe("9007199254740991");
  });
});

import type { AddressInfo } from "node:net";
import type { RequestListener } from "node:http";
import { createServer } from "node:http";
import type { JWTPayload } from "jose";
import {
  createRemoteJWKSet,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { jwksFetchFailure } from "./jwks-failure";

// Real jose against real local endpoints: the classifier depends on exactly
// what jose and undici throw, so hand-built errors would prove nothing.

const servers: ReturnType<typeof createServer>[] = [];

async function serve(handler: RequestListener): Promise<URL> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${port}/.well-known/jwks.json`);
}

const respond =
  (status: number, body: string): RequestListener =>
  (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  };

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) =>
            server.close(() => resolve()).closeAllConnections(),
          ),
      ),
  );
});

let signing: CryptoKey;
let other: CryptoKey;
let jwks: string;

const sign = (key: CryptoKey, claims: JWTPayload = {}) =>
  new SignJWT({ token_use: "access", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signing = pair.privateKey;
  other = (await generateKeyPair("RS256")).privateKey;
  jwks = JSON.stringify({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }],
  });
});

/** The reason jwksFetchFailure gives for verifying `token` against `url`. */
async function reasonFor(
  url: URL,
  token?: string,
  timeoutDuration = 2000,
): Promise<string | undefined> {
  try {
    await jwtVerify(
      token ?? (await sign(signing)),
      createRemoteJWKSet(url, { timeoutDuration }),
      { algorithms: ["RS256"] },
    );
  } catch (err) {
    return jwksFetchFailure(err);
  }
  throw new Error("expected jwtVerify to fail");
}

describe("jwksFetchFailure: the key set couldn't be fetched", () => {
  it("reports nothing listening (connection refused)", async () => {
    const url = await serve(respond(200, jwks));
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
    expect(await reasonFor(url)).toBe("ECONNREFUSED");
  });

  it("reports an HTTP error response", async () => {
    expect(await reasonFor(await serve(respond(503, "unavailable")))).toBe(
      "ERR_JOSE_GENERIC",
    );
  });

  it("reports a 200 whose body is not JSON", async () => {
    expect(await reasonFor(await serve(respond(200, "<html>")))).toBe(
      "ERR_JOSE_GENERIC",
    );
  });

  it("reports JSON that isn't a key set", async () => {
    expect(await reasonFor(await serve(respond(200, "{}")))).toBe(
      "ERR_JWKS_INVALID",
    );
  });

  it("reports a timeout", async () => {
    const url = await serve(() => undefined); // never responds
    expect(await reasonFor(url, undefined, 50)).toBe("ERR_JWKS_TIMEOUT");
  });

  it("uses the network code from a fetch failure's cause, or a generic one", () => {
    const withCause = new TypeError("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND auth"), {
        code: "ENOTFOUND",
      }),
    });
    expect(jwksFetchFailure(withCause)).toBe("ENOTFOUND");
    expect(jwksFetchFailure(new TypeError("fetch failed"))).toBe(
      "fetch_failed",
    );
  });
});

describe("jwksFetchFailure: a caller-caused failure stays silent", () => {
  it("ignores an unknown key id (old or forged token)", async () => {
    expect(
      await reasonFor(await serve(respond(200, '{"keys":[]}'))),
    ).toBeUndefined();
  });

  it("ignores an expired token", async () => {
    const expired = await new SignJWT({ token_use: "access" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(signing);
    expect(
      await reasonFor(await serve(respond(200, jwks)), expired),
    ).toBeUndefined();
  });

  it("ignores a token signed by another key", async () => {
    expect(
      await reasonFor(await serve(respond(200, jwks)), await sign(other)),
    ).toBeUndefined();
  });

  it("ignores a bearer that isn't a JWT (an API key)", async () => {
    expect(
      await reasonFor(await serve(respond(200, jwks)), "f3_not_a_jwt"),
    ).toBeUndefined();
  });

  it("ignores programming errors and non-Error values", () => {
    expect(
      jwksFetchFailure(new TypeError("Cannot read properties of undefined")),
    ).toBeUndefined();
    expect(jwksFetchFailure("fetch failed")).toBeUndefined();
  });
});

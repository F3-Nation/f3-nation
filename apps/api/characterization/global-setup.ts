import { createServer } from "node:http";
import type { Server } from "node:http";
import { exportJWK, generateKeyPair } from "jose";

/** Must match the kid apps/auth/src/lib/jwt.ts stamps on real tokens. */
export const FIXTURE_KID = "f3-auth-1";

let server: Server | undefined;

export async function setup() {
  // Generated per run; nothing is ever written to disk or committed.
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });

  const publicJwk = await exportJWK(publicKey);
  const jwks = {
    keys: [{ ...publicJwk, alg: "RS256", use: "sig", kid: FIXTURE_KID }],
  };

  server = createServer((req, res) => {
    if (req.url === "/.well-known/jwks.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(jwks));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) =>
    server!.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("JWKS fixture server failed to bind a port");
  }

  // packages/api/src/shared.ts builds createRemoteJWKSet from this at module
  // import time; workers fork from this process, so it must be set here and
  // not in a setupFile.
  process.env.NEXT_PUBLIC_AUTH_URL = `http://127.0.0.1:${address.port}`;
  process.env.CHAR_TEST_SIGNING_JWK = JSON.stringify(
    await exportJWK(privateKey),
  );
}

export async function teardown() {
  await new Promise<void>((resolve, reject) =>
    server ? server.close((e) => (e ? reject(e) : resolve())) : resolve(),
  );
}

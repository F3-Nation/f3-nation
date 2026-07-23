import { createServer } from "node:http";
import type { Server } from "node:http";
import { exportJWK, generateKeyPair } from "jose";

/** Must match the kid apps/auth/src/lib/jwt.ts stamps on real tokens. */
export const FIXTURE_KID = "f3-auth-1";

/** Stable synthetic origin, matched to transport.ts's CHAR_BASE. */
const CHAR_BASE = "http://api.characterization.test";

let server: Server | undefined;

export async function setup(): Promise<void> {
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

  await new Promise<void>((resolve, reject) => {
    server!.once("error", (err) =>
      reject(new Error("JWKS fixture server failed to listen", { cause: err })),
    );
    server!.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("JWKS fixture server failed to bind a port");
  }

  // packages/api/src/shared.ts builds createRemoteJWKSet from this at module
  // import time; workers fork from this process, so it must be set here and
  // not in a setupFile.
  process.env.NEXT_PUBLIC_AUTH_URL = `http://127.0.0.1:${address.port}`;
  // Pin the API base so the `/` redirect target and the OpenAPI servers[0].url
  // are identical across developers and targets instead of leaking a per-dev
  // NEXT_PUBLIC_API_URL from apps/api/.env into goldens.
  process.env.NEXT_PUBLIC_API_URL = CHAR_BASE;
  process.env.CHAR_TEST_SIGNING_JWK = JSON.stringify(
    await exportJWK(privateKey),
  );

  // Make a reduced (e.g. live) run visible so a stray CHAR_TEST_TARGET in .env
  // can't be mistaken for a full run.
  const kind = process.env.CHAR_TEST_TARGET ?? "next";
  const base = process.env.CHAR_TEST_BASE_URL ?? CHAR_BASE;
  console.info(`[characterization] target=${kind} baseUrl=${base}`);
}

export async function teardown(): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server ? server.close((e) => (e ? reject(e) : resolve())) : resolve(),
  );
  // Drop the handle so a second setup() cannot close a stale server.
  server = undefined;
}

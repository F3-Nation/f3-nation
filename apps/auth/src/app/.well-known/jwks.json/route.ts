import { NextResponse } from "next/server";
import type { JWK } from "jose";

import { getAuth } from "~/lib/better-auth";
import { getJWKS } from "~/lib/jwt";
import { logError } from "~/lib/logging";
import { env } from "~/env";

/**
 * Relying parties fetch keys from the origin root (packages/sso resolves
 * "/.well-known/jwks.json" against the auth URL; packages/api appends it),
 * never from Better Auth's own /api/auth2/jwks. So with the flag on, this
 * also serves Better Auth's keys, next to the hand-rolled f3-auth-1 key that
 * /api/oauth/* still signs with. Their kids never collide: Better Auth's are
 * generated ids.
 */
export async function GET() {
  const legacy = await getJWKS();
  if (!env.AUTH_USE_BETTER_AUTH) return jwksResponse(legacy.keys, true);

  // Better Auth's keys live in the database. If they can't be served, still
  // serve the legacy key so /api/oauth/* tokens keep verifying, but don't let
  // a cache hold on to the partial set. A failure to construct the instance
  // (e.g. BETTER_AUTH_SECRET unset) is a misconfiguration, not a read blip,
  // so it gets its own event.
  let auth: Awaited<ReturnType<typeof getAuth>>;
  try {
    auth = await getAuth();
  } catch (err) {
    logError("auth.jwks.better_auth_instance_failed", {}, err);
    return jwksResponse(legacy.keys, false);
  }
  try {
    const betterAuth = await auth.api.getJwks();
    return jwksResponse([...legacy.keys, ...betterAuth.keys], true);
  } catch (err) {
    logError("auth.jwks.better_auth_keys_failed", {}, err);
    return jwksResponse(legacy.keys, false);
  }
}

function jwksResponse(keys: JWK[], cacheable: boolean) {
  return NextResponse.json(
    { keys },
    {
      headers: {
        "Cache-Control": cacheable ? "public, max-age=3600" : "no-store",
      },
    },
  );
}

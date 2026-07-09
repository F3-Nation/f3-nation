import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_TOKEN_COOKIE_NAME } from "@/lib/auth/constants";
import { verifyAccessTokenPayload } from "@/lib/auth/tokens";

export interface SessionPayload {
  // SSO subject is represented as a string in token/userinfo payloads.
  sub: string;
  email: string;
  // Internal app logic expects a numeric identifier for API payloads/DB writes.
  userId: number;
}

/**
 * Verify the JWT signature and extract claims — full RS256 + expiry check via
 * JWKS.  This runs at the point of use (route handlers, Server Components) so
 * that protected resources are not reachable with a forged or expired token
 * even if middleware is misconfigured or bypassed (#371).
 *
 * The shared verifier caches the JWKS response internally (15-minute TTL) so
 * only the first request per cold-start incurs a network round-trip.
 */
const getCachedSessionPayload = cache(async (accessToken: string) => {
  const payload = await verifyAccessTokenPayload(accessToken);
  if (!payload?.sub || !payload?.email) return null;

  const userId = Number(payload.sub);
  if (!Number.isFinite(userId) || userId <= 0) return null;

  return {
    sub: payload.sub,
    email: payload.email,
    userId,
  } satisfies SessionPayload;
});

async function getAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value ?? null;
}

export async function getSessionUser(): Promise<SessionPayload | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;
  return await getCachedSessionPayload(accessToken);
}

export async function requireAuth(): Promise<SessionPayload> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }
  return user;
}

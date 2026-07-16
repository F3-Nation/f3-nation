import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAccessToken } from "@f3nation/sso";
import { ACCESS_TOKEN_COOKIE_NAME } from "@/lib/auth/constants";
import { env } from "@/env";
import { logDebug, logWarn } from "@/lib/logging";

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
 * The shared verifier caches the JWKS response internally (10-minute TTL) so
 * at most one JWKS fetch occurs per 10-minute window per instance.
 */
const getCachedSessionPayload = cache(async (accessToken: string) => {
  const result = await verifyAccessToken(
    accessToken,
    env.AUTH_PROVIDER_URL,
    env.OAUTH_CLIENT_ID,
    true,
  );

  if (!result.ok) {
    if (result.code === "expired") {
      logDebug("me.auth.session_token_expired", {});
    } else {
      logWarn("me.auth.session_verify_failed", {
        code: result.code,
        message: result.error,
      });
    }
    return null;
  }

  const payload = result.payload;
  if (!payload.sub || !payload.email) {
    logWarn("me.auth.session_claims_invalid", {
      reason: !payload.sub ? "missing_sub" : "missing_email",
    });
    return null;
  }

  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    logWarn("me.auth.session_claims_invalid", { reason: "non_integer_sub" });
    return null;
  }

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

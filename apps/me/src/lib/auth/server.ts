import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/lib/auth/constants";
import { parseAccessTokenPayload } from "@/lib/auth/tokens";

export interface SessionPayload {
  // SSO subject is represented as a string in token/userinfo payloads.
  sub: string;
  email: string;
  // Internal app logic expects a numeric identifier for API payloads/DB writes.
  userId: number;
}

/**
 * Decode the already-middleware-verified JWT locally — no network call needed.
 * Middleware performs full RS256 signature + expiry verification; here we just
 * extract the claims we need from the payload.
 */
const getCachedSessionPayload = cache((accessToken: string) => {
  const payload = parseAccessTokenPayload(accessToken);
  if (!payload?.sub || !payload?.email) return null;

  const userId = Number(payload.sub);
  if (!Number.isFinite(userId) || userId <= 0) return null;

  return {
    sub: payload.sub,
    email: payload.email,
    userId,
  } satisfies SessionPayload;
});

export async function getAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(REFRESH_TOKEN_COOKIE_NAME)?.value ?? null;
}

export async function getSessionUser(): Promise<SessionPayload | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;
  return getCachedSessionPayload(accessToken);
}

export async function requireAuth(): Promise<SessionPayload> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/");
  }
  return user;
}

export async function requireAccessToken(): Promise<string> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    redirect("/");
  }

  const user = getCachedSessionPayload(accessToken);
  if (!user) {
    redirect("/");
  }

  return accessToken;
}

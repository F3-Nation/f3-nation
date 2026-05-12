import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "./constants";
import type { AdminSession } from "./session";
import { parseAccessTokenPayload } from "./tokens";

const getCachedSessionPayload = cache((accessToken: string) => {
  let payload: ReturnType<typeof parseAccessTokenPayload>;
  try {
    payload = parseAccessTokenPayload(accessToken);
  } catch {
    return null;
  }

  if (!payload?.sub || !payload.email) return null;

  const id = Number(payload.sub);
  if (!Number.isFinite(id) || id <= 0) return null;

  return {
    sub: payload.sub,
    id,
    email: payload.email,
    name: payload.name,
    roles: payload.roles ?? [],
  } satisfies AdminSession;
});

export async function getAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(REFRESH_TOKEN_COOKIE_NAME)?.value ?? null;
}

export function getSessionFromAccessToken(
  accessToken: string,
): AdminSession | null {
  return getCachedSessionPayload(accessToken);
}

export async function getSessionUser(): Promise<AdminSession | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;
  return getSessionFromAccessToken(accessToken);
}

export async function requireAuth(): Promise<AdminSession> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/api/auth/login");
  }

  return user;
}

export async function requireAccessToken(): Promise<string> {
  const accessToken = await getAccessToken();
  if (!accessToken || !getSessionFromAccessToken(accessToken)) {
    redirect("/api/auth/login");
  }

  return accessToken;
}

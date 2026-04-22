import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from "@/lib/auth/constants";
import { getUserInfo } from "@/lib/auth/oauth";

export interface SessionPayload {
  sub: string;
  email: string;
  name?: string;
  userId: number;
}

const getCachedUserInfo = cache(async (accessToken: string) => {
  try {
    const user = await getUserInfo(accessToken);
    if (!user.email) return null;

    return {
      sub: String(user.sub),
      email: user.email,
      name: user.name,
      userId: user.sub,
    } satisfies SessionPayload;
  } catch {
    return null;
  }
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
  return getCachedUserInfo(accessToken);
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

  const user = await getCachedUserInfo(accessToken);
  if (!user) {
    redirect("/");
  }

  return accessToken;
}

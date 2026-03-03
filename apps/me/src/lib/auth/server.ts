import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "./constants";
import { verifySession, type SessionPayload } from "./session";

export async function getSessionUser(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);
  if (!sessionCookie?.value) return null;
  return verifySession(sessionCookie.value);
}

export async function requireAuth(): Promise<SessionPayload> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/?error=unauthenticated");
  }
  return user;
}

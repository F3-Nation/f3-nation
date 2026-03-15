import "server-only";
import { cookies } from "next/headers";
import type { UserProfile, Region, UserListItem } from "@/lib/types";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { verifySessionValue } from "@/lib/auth/session";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Build headers for API calls. Includes X-User-Id from the session cookie
 * so the API knows which user the request is for.
 */
async function getHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${requireEnv("F3_API_KEY")}`,
    Client: "f3-me",
    "Content-Type": "application/json",
  };

  // Read userId from the session cookie and pass as X-User-Id
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (sessionCookie) {
    const session = verifySessionValue(sessionCookie);
    if (session?.userId) {
      headers["X-User-Id"] = String(session.userId);
    }
  }

  return headers;
}

/**
 * Build headers for the email lookup call during OAuth callback.
 * Does NOT include X-User-Id since we don't have it yet.
 */
function getBaseHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${requireEnv("F3_API_KEY")}`,
    Client: "f3-me",
    "Content-Type": "application/json",
  };
}

function apiUrl(path: string): string {
  return `${requireEnv("F3_API_BASE_URL")}${path}`;
}

/**
 * Get the authenticated user's full profile (user fields + roles + positions).
 * Calls GET /me/profile on the F3 API.
 */
export async function getMyProfile(): Promise<UserProfile> {
  const res = await fetch(apiUrl("/me/profile"), {
    headers: await getHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { user: UserProfile };
  return data.user;
}

/**
 * Update the authenticated user's profile.
 * Calls PATCH /me/profile on the F3 API.
 */
export async function updateMyProfile(
  body: Record<string, unknown>,
): Promise<UserProfile> {
  const res = await fetch(apiUrl("/me/profile"), {
    method: "PATCH",
    headers: await getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { user: UserProfile };
  return data.user;
}

/**
 * List all regions (active and inactive) for the region dropdown.
 * Calls GET /me/regions on the F3 API.
 */
export async function getRegions(): Promise<Region[]> {
  const res = await fetch(apiUrl("/me/regions"), {
    headers: await getHeaders(),
    next: { revalidate: 3600 }, // Cache for 1 hour
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { orgs: Region[] };
  return data.orgs;
}

/**
 * Remove the authenticated user from a position assignment.
 * Calls DELETE /me/positions on the F3 API.
 */
export async function deleteMyPosition(
  orgId: number,
  positionId: number,
): Promise<{ success: boolean; found: boolean }> {
  const res = await fetch(apiUrl("/me/positions"), {
    method: "DELETE",
    headers: await getHeaders(),
    body: JSON.stringify({ orgId, positionId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return (await res.json()) as { success: boolean; found: boolean };
}

/**
 * Remove the authenticated user from a role assignment.
 * Calls DELETE /me/roles on the F3 API.
 */
export async function deleteMyRole(
  orgId: number,
  roleId: number,
): Promise<{ success: boolean; found: boolean }> {
  const res = await fetch(apiUrl("/me/roles"), {
    method: "DELETE",
    headers: await getHeaders(),
    body: JSON.stringify({ orgId, roleId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return (await res.json()) as { success: boolean; found: boolean };
}

/**
 * List users for the "Who Brought You?" dropdown.
 * Optionally filter by homeRegionId.
 */
export async function getUsers(
  homeRegionId?: number | null,
): Promise<UserListItem[]> {
  const params = new URLSearchParams();
  if (homeRegionId) {
    params.set("homeRegionId", String(homeRegionId));
  }
  const qs = params.toString();
  const res = await fetch(apiUrl(`/me/users${qs ? `?${qs}` : ""}`), {
    headers: await getHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { users: UserListItem[] };
  return data.users;
}

/**
 * Look up a user's numeric ID by email address.
 * Used during OAuth callback before the session cookie exists.
 * Uses getBaseHeaders() (no X-User-Id needed).
 */
export async function lookupUserByEmail(email: string): Promise<number> {
  const params = new URLSearchParams({ email });
  const res = await fetch(apiUrl(`/me/lookup-by-email?${params.toString()}`), {
    headers: getBaseHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { userId: number };
  return data.userId;
}

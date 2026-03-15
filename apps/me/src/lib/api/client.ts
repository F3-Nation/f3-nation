import "server-only";
import type { UserProfile, Region, UserListItem } from "@/lib/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getHeaders(): HeadersInit {
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
    headers: getHeaders(),
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
    headers: getHeaders(),
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
    headers: getHeaders(),
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
    headers: getHeaders(),
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
    headers: getHeaders(),
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
    headers: getHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { users: UserListItem[] };
  return data.users;
}

import "server-only";
import type { UserProfile, Region, OrgPositionAssignments } from "@/lib/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const API_BASE = requireEnv("F3_API_BASE_URL");
const API_KEY = requireEnv("F3_API_KEY");

function getHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${API_KEY}`,
    Client: "f3-me",
    "Content-Type": "application/json",
  };
}

export async function getUser(id: number): Promise<UserProfile> {
  const res = await fetch(`${API_BASE}/v1/user/id/${id}?includePii=true`, {
    headers: getHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return (await res.json()) as UserProfile;
}

export async function getUserByEmail(
  email: string,
): Promise<UserProfile | null> {
  const res = await fetch(
    `${API_BASE}/v1/user/email/${encodeURIComponent(email)}?includePii=true`,
    {
      headers: getHeaders(),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { user: UserProfile | null };
  return data.user;
}

export async function updateUser(
  body: Record<string, unknown>,
): Promise<UserProfile> {
  const res = await fetch(`${API_BASE}/v1/user`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return (await res.json()) as UserProfile;
}

export async function getRegions(): Promise<Region[]> {
  const res = await fetch(`${API_BASE}/v1/org?orgType=region&isActive=true`, {
    headers: getHeaders(),
    next: { revalidate: 3600 }, // Cache for 1 hour
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { orgs: Region[]; total: number };
  return data.orgs;
}

export async function getPositionAssignments(
  orgId: number,
): Promise<OrgPositionAssignments> {
  const res = await fetch(`${API_BASE}/v1/position/assignments/${orgId}`, {
    headers: getHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return (await res.json()) as OrgPositionAssignments;
}

export async function updatePositionAssignments(
  orgId: number,
  assignments: { positionId: number; userIds: number[] }[],
): Promise<OrgPositionAssignments> {
  const res = await fetch(`${API_BASE}/v1/position/assignments`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify({ orgId, assignments }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return (await res.json()) as OrgPositionAssignments;
}

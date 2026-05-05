import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { router } from "@acme/api";
import { Client, Header } from "@acme/shared/common/enums";
import { ACCESS_TOKEN_COOKIE_NAME } from "@/lib/auth/constants";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Per-request cached oRPC client factory.
 *
 * Reads the authenticated user's OAuth access token from cookies and creates
 * a typed oRPC client pointed at F3_API_BASE_URL. The React cache() ensures
 * at most one client is created per server request.
 */
export const getApiClient = cache(
  async (): Promise<RouterClient<typeof router>> => {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    if (!accessToken) throw new Error("Missing access token");

    const link = new RPCLink({
      url: requireEnv("F3_API_BASE_URL"),
      fetch: (input, init) => {
        input.headers.set(Header.Client, Client.F3_ME);
        input.headers.set(Header.Authorization, `Bearer ${accessToken}`);
        return fetch(input, init);
      },
    });

    return createORPCClient<RouterClient<typeof router>>(link);
  },
);

/**
 * Get the authenticated user's full profile (user fields + roles + positions).
 */
export async function getMyProfile() {
  const client = await getApiClient();
  const result = await client.me.profile();
  return result.user;
}

/**
 * Update the authenticated user's profile.
 */
export async function updateMyProfile(
  body: Parameters<RouterClient<typeof router>["me"]["updateProfile"]>[0],
) {
  const client = await getApiClient();
  const result = await client.me.updateProfile(body);
  return result.user;
}

/**
 * List all regions (active and inactive) for the region dropdown.
 */
export async function getRegions() {
  const client = await getApiClient();
  const result = await client.me.regions();
  return result.orgs;
}

/**
 * Remove the authenticated user from a position assignment.
 */
export async function deleteMyPosition(orgId: number, positionId: number) {
  const client = await getApiClient();
  return client.me.deletePosition({ orgId, positionId });
}

/**
 * Remove the authenticated user from a role assignment.
 */
export async function deleteMyRole(orgId: number, roleId: number) {
  const client = await getApiClient();
  return client.me.deleteRole({ orgId, roleId });
}

/**
 * List users for the "Who Brought You?" dropdown.
 * Optionally filter by homeRegionId.
 */
export async function getUsers(homeRegionId?: number | null) {
  const client = await getApiClient();
  const result = await client.me.users(
    homeRegionId ? { homeRegionId } : undefined,
  );
  return result.users;
}

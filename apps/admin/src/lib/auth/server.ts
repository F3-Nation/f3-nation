import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAccessToken } from "@acme/sso";

import { routes } from "@acme/shared/app/constants";

import { ACCESS_TOKEN_COOKIE_NAME } from "./constants";
import type { AdminSession } from "./session";
import { env } from "~/env";
import { logDebug, logWarn } from "~/lib/logging";
import { getMyProfile } from "~/lib/api/client";

const NO_ADMIN_ACCESS_PATH = `${routes.admin.noAccess.__path}?reason=no-admin-access`;

const getCachedSessionPayload = cache(async (accessToken: string) => {
  const result = await verifyAccessToken(
    accessToken,
    env.AUTH_PROVIDER_URL,
    env.OAUTH_CLIENT_ID,
    true,
  );

  if (!result.ok) {
    if (result.code === "expired") {
      logDebug("admin.auth.session_token_expired", {});
    } else {
      logWarn("admin.auth.session_verify_failed", {
        code: result.code ?? "misconfigured",
        message: result.error,
      });
    }
    return null;
  }

  const payload = result.payload;
  if (!payload.sub || !payload.email) return null;

  const id = Number(payload.sub);
  if (!Number.isFinite(id) || id <= 0) return null;

  return {
    sub: payload.sub,
    id,
    email: payload.email,
    name: payload.name,
    roles: [],
  } satisfies AdminSession;
});

export async function getAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value ?? null;
}

async function getSessionFromAccessToken(
  accessToken: string,
): Promise<AdminSession | null> {
  return getCachedSessionPayload(accessToken);
}

export async function getSessionUser(): Promise<AdminSession | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;
  const session = await getSessionFromAccessToken(accessToken);
  if (!session) return null;

  try {
    const profile = await getMyProfile();

    return {
      ...session,
      roles: profile.roles.map((role) => ({
        roleId: role.roleId,
        orgId: role.orgId,
        orgName: role.orgName,
        roleName: role.roleName,
      })),
    };
  } catch (error) {
    console.warn("Failed to hydrate admin roles from API", error);
    return session;
  }
}

export async function requireAdminPortalAccess(
  session?: AdminSession | null,
): Promise<AdminSession> {
  const user = session ?? (await getSessionUser());
  if (!user) {
    redirect("/api/auth/login");
  }

  if (
    !user.roles.some(
      (role) => role.roleName === "admin" || role.roleName === "editor",
    )
  ) {
    redirect(NO_ADMIN_ACCESS_PATH);
  }

  return user;
}

export async function requireAccessToken(): Promise<string> {
  const accessToken = await getAccessToken();
  if (!accessToken || !(await getSessionFromAccessToken(accessToken))) {
    redirect("/api/auth/login");
  }

  return accessToken;
}

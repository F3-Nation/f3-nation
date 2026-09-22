import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAccessToken } from "@f3nation/sso-next";

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
        code: result.code,
        message: result.error,
      });
    }
    return null;
  }

  const payload = result.payload;
  if (!payload.sub || !payload.email) {
    logWarn("admin.auth.session_claims_invalid", {
      reason: !payload.sub ? "missing_sub" : "missing_email",
    });
    return null;
  }

  const id = Number(payload.sub);
  if (!Number.isInteger(id) || id <= 0) {
    logWarn("admin.auth.session_claims_invalid", { reason: "non_integer_sub" });
    return null;
  }

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
    // If the access token cookie is still present the proxy already accepted
    // its signature and expiry — the session is null because of invalid
    // application-level claims. Redirecting to /api/auth/login would
    // re-issue an identical token, creating an infinite redirect loop.
    if (await getAccessToken()) {
      redirect(`${routes.admin.noAccess.__path}?reason=invalid-session`);
    }
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
  if (!accessToken) {
    redirect("/api/auth/login");
  }
  if (!(await getSessionFromAccessToken(accessToken))) {
    // Token passed proxy validation but claims are invalid — login would loop.
    redirect(`${routes.admin.noAccess.__path}?reason=invalid-session`);
  }

  return accessToken;
}

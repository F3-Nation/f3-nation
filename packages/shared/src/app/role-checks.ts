import { F3_NATION_ORG_ID } from "./constants";

/**
 * Minimal session-like type for role checks.
 * Matches the shape of Session.roles from @acme/auth.
 */
export interface SessionWithRoles {
  roles?: {
    roleName: string;
    orgId: number;
    orgName?: string | null;
  }[];
}

/**
 * Returns true if the session has admin role on the F3 Nation org (orgId 1).
 * Uses session.roles - the same check used by nationAdminProcedure and map revalidate.
 */
export function isNationAdminFromSession(
  session: SessionWithRoles | null,
): boolean {
  return (
    session?.roles?.some(
      (r) =>
        r.roleName === "admin" &&
        r.orgId === F3_NATION_ORG_ID &&
        (r.orgName?.toLowerCase().includes("f3 nation") ?? false),
    ) ?? false
  );
}

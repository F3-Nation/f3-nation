/**
 * Super-admin lookup for F3R5_013 platform operations
 * (drift-acknowledgment, and future break-glass paths).
 *
 * Supabase's role registry has no global "super admin" concept — the
 * existing `rolesXUsersXOrg` table is scoped per-org. Decision 8 calls
 * for a tiny set of platform super-admins who sign off on drift, and
 * this is expected to be on the order of 2–5 people. Rather than
 * shoehorning a new role into Supabase we read from an env-driven
 * allowlist:
 *
 *     REDIRECT_ADMIN_SUPER_ADMIN_USER_IDS=1,42,128
 *
 * The allowlist is validated at call time (not at module load) so
 * tests + dev can run with the var unset.
 */

import "server-only";

const ENV_VAR = "REDIRECT_ADMIN_SUPER_ADMIN_USER_IDS";

/** Pure parser. Invalid entries are dropped silently. */
export function parseSuperAdminAllowlist(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function isSuperAdmin(
  userId: number,
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  const allow = parseSuperAdminAllowlist(source[ENV_VAR]);
  return allow.includes(userId);
}

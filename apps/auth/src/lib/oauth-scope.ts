/**
 * The "only issue an ID Token if openid was actually granted" rule, used by
 * both grant handlers in oauth.ts. Kept in its own file, deliberately with
 * no imports, so this security-critical gate is testable with no DB and no
 * env — putting it in oauth.ts itself would drag in ~/lib/db's env
 * validation at import time just to test a string predicate that doesn't
 * use either.
 */
export function idTokenScopeOrNull(
  grantedScopes: string | null | undefined,
): string | null {
  return grantedScopes?.split(" ").includes("openid") ? grantedScopes : null;
}

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

/**
 * Drops `offline_access` from a requested scope string unless the client
 * registered it. The hand-rolled server always issues a refresh token, so
 * the scope means nothing here, but relying parties send it for auth3
 * (Better Auth issues refresh tokens only when it's granted). Stripping it
 * before validation lets one client config work against both servers
 * without registering the scope on every legacy client. A client that did
 * register it keeps it, so its granted scope matches its registration.
 *
 * Only the `offline_access` tokens are removed; the rest of the string,
 * spacing included, is kept as is, so `validateScopes` judges it exactly as
 * before. A request for `offline_access` alone becomes `""`, which
 * `validateScopes` rejects: there's no real scope left to grant.
 */
export function withoutOfflineAccess(
  requestedScopes: string,
  registeredScopes: string | null | undefined,
): string {
  // Same fallback as validateScopes in oauth.ts.
  const registered = (registeredScopes ?? "openid profile email").split(" ");
  if (registered.includes("offline_access")) return requestedScopes;
  const scopes = requestedScopes.split(" ");
  if (!scopes.includes("offline_access")) return requestedScopes;
  return scopes.filter((s) => s !== "offline_access").join(" ");
}

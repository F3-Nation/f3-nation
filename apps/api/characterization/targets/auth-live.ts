/**
 * Live target for the token PRODUCER (a deployed apps/auth: auth2 today,
 * auth3 at cutover), the counterpart of live.ts, which targets the apps/api
 * consumer. It is configured independently of CHAR_TEST_TARGET because the
 * auth server is a different deployment with its own URL: everything that
 * uses it is skipped unless CHAR_TEST_AUTH_ISSUER is set.
 *
 * Env:
 *   CHAR_TEST_AUTH_ISSUER         the issuer URL exactly as tokens carry it
 *                                 in `iss` (e.g. https://auth2.example.com, or
 *                                 https://auth3.example.com/api/auth2 for the
 *                                 Better Auth instance). Discovery is read
 *                                 from `<issuer>/.well-known/openid-configuration`.
 *   CHAR_TEST_AUTH_PROVIDER_URL   optional: the relying parties'
 *                                 AUTH_PROVIDER_URL, which apps/admin and
 *                                 apps/me pass as the expected `iss`. Defaults
 *                                 to the issuer's origin.
 *   CHAR_TEST_AUTH_CLIENT_ID      a confidential client allowed the
 *   CHAR_TEST_AUTH_CLIENT_SECRET  client_credentials grant (both or neither;
 *                                 Better Auth only).
 *   CHAR_TEST_AUTH_USER_TOKEN     an access token a real sign-in minted, and
 *   CHAR_TEST_AUTH_USER_CLIENT_ID the client it was issued to (both or neither).
 */

export interface AuthLiveTarget {
  /** Issuer without a trailing slash, as discovery and `iss` must state it. */
  issuer: string;
  /** What the relying parties pass to verifyAccessToken as AUTH_PROVIDER_URL. */
  authProviderUrl: string;
  clientCredentials?: { clientId: string; clientSecret: string };
  userToken?: { token: string; clientId: string };
}

function pair(aName: string, bName: string): [string, string] | undefined {
  const a = process.env[aName];
  const b = process.env[bName];
  if (!a && !b) return undefined;
  if (!a || !b) {
    throw new Error(`${aName} and ${bName} must be set together`);
  }
  return [a, b];
}

function resolveAuthTarget(): AuthLiveTarget | undefined {
  const raw = process.env.CHAR_TEST_AUTH_ISSUER;
  if (!raw) return undefined;
  // Throws on a malformed URL, so a typo fails loudly instead of skipping.
  const issuer = new URL(raw).toString().replace(/\/$/, "");

  const credentials = pair(
    "CHAR_TEST_AUTH_CLIENT_ID",
    "CHAR_TEST_AUTH_CLIENT_SECRET",
  );
  const user = pair(
    "CHAR_TEST_AUTH_USER_TOKEN",
    "CHAR_TEST_AUTH_USER_CLIENT_ID",
  );

  // Passed through as given: the apps use their AUTH_PROVIDER_URL verbatim as
  // the expected `iss`, so a trailing slash must fail here as it does there.
  const providerRaw = process.env.CHAR_TEST_AUTH_PROVIDER_URL;
  if (providerRaw) new URL(providerRaw); // throws on a malformed URL
  const authProviderUrl = providerRaw ?? new URL(issuer).origin;

  return {
    issuer,
    authProviderUrl,
    clientCredentials: credentials && {
      clientId: credentials[0],
      clientSecret: credentials[1],
    },
    userToken: user && { token: user[0], clientId: user[1] },
  };
}

export const authTarget = resolveAuthTarget();

/** fetch with the same timeout and error surfacing as live.ts. */
export async function authFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      ...init,
    });
  } catch (err) {
    throw new Error(
      `auth live target request failed: ${init?.method ?? "GET"} ${url}`,
      { cause: err },
    );
  }
}

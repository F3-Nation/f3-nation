/**
 * Glue between the stable /api/oauth/* URLs relying parties hardcode
 * (packages/sso, sso-next, Digital Weinke's logout) and Better Auth's own
 * OAuth endpoints under /api/auth2/oauth2/*. Only used while
 * AUTH_USE_BETTER_AUTH is on; each route checks the flag itself and keeps
 * its hand-rolled code path for when it's off.
 */
import { NextResponse } from "next/server";

import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { constantTimeEqual, makeSignature } from "better-auth/crypto";

import { BETTER_AUTH_BASE_PATH, getAuth } from "~/lib/better-auth";
import { env } from "~/env";

export type BetterAuthOAuthEndpoint =
  "authorize" | "token" | "userinfo" | "revoke";

/**
 * Re-issues `request` against Better Auth's /oauth2/<endpoint>, keeping its
 * method, query string, headers and body.
 *
 * `dropCookies` is for the endpoints that authenticate a client or a bearer
 * token, never a browser session (token, userinfo, revoke). A browser
 * calling them cross-origin can still send this origin's cookies, and Better
 * Auth checks the Origin of any cookie-carrying POST against its
 * trustedOrigins, which knows nothing of the per-client allowed origins the
 * CORS headers come from.
 */
export async function forwardToBetterAuth(
  request: Request,
  endpoint: BetterAuthOAuthEndpoint,
  options: {
    dropCookies?: boolean;
    dropAuthorization?: boolean;
    body?: string;
  } = {},
): Promise<Response> {
  const auth = await getAuth();
  const target = new URL(
    `${BETTER_AUTH_BASE_PATH}/oauth2/${endpoint}`,
    env.NEXT_PUBLIC_AUTH_URL,
  );
  target.search =
    endpoint === "authorize"
      ? await resolveLoginMarker(auth, request)
      : new URL(request.url).search;

  const headers = new Headers(request.headers);
  if (options.dropCookies) headers.delete("cookie");
  if (options.dropAuthorization) headers.delete("authorization");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return auth.handler(
    new Request(target, {
      method: request.method,
      headers,
      body: hasBody ? (options.body ?? (await request.text())) : undefined,
    }),
  );
}

// The plugin's own signing parameters.
const STRIPPED_PARAMS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"];
// Already satisfied by the page the user is sent to. Left in, the plugin
// would redirect to that page again on every pass.
const SATISFIED_PROMPTS = new Set(["login", "create"]);

// Added to the authorize callbackUrl when the request forced a fresh login
// (prompt=login or max_age), whose parameters are stripped so the sign-in
// doesn't loop. Its value is `<issued-at ms>.<signature>`: when authorize
// comes back, a session created before that moment doesn't count as the
// login that was asked for, so someone who opens the callback URL with an
// older session is sent to log in again instead of skipping it.
const LOGIN_MARKER_PARAM = "f3_login_after";
// How long after the redirect a session still counts as that login.
const LOGIN_MARKER_TTL_MS = 60 * 60 * 1000;

type OAuthAuth = Awaited<ReturnType<typeof getAuth>>;

async function signLoginMarker(auth: OAuthAuth, issuedAt: number) {
  const { secret } = await auth.$context;
  return `${issuedAt}.${await makeSignature(`${LOGIN_MARKER_PARAM}:${issuedAt}`, secret)}`;
}

async function loginMarkerIssuedAt(auth: OAuthAuth, marker: string) {
  const [issuedAtText, signature] = marker.split(".");
  const issuedAt = Number(issuedAtText);
  if (!signature || !Number.isInteger(issuedAt)) return null;
  const expected = await signLoginMarker(auth, issuedAt);
  if (!constantTimeEqual(expected, marker)) return null;
  if (Date.now() - issuedAt > LOGIN_MARKER_TTL_MS || issuedAt > Date.now()) {
    return null;
  }
  return issuedAt;
}

/**
 * The query string authorize is forwarded with. A request without the login
 * marker is untouched. With it, the marker is removed and checked: if the
 * browser's session wasn't created after the marker was issued (or the
 * marker is forged or expired), prompt=login is put back so Better Auth
 * sends the user to sign in again.
 */
async function resolveLoginMarker(auth: OAuthAuth, request: Request) {
  const url = new URL(request.url);
  const marker = url.searchParams.get(LOGIN_MARKER_PARAM);
  if (marker === null) return url.search;
  url.searchParams.delete(LOGIN_MARKER_PARAM);

  const issuedAt = await loginMarkerIssuedAt(auth, marker);
  const session = issuedAt
    ? await auth.api.getSession({ headers: request.headers })
    : null;
  const freshLogin =
    issuedAt !== null &&
    session !== null &&
    session.session.createdAt.getTime() >= issuedAt;
  if (!freshLogin) {
    const prompts = new Set((url.searchParams.get("prompt") ?? "").split(" "));
    prompts.delete("");
    prompts.add("login");
    url.searchParams.set("prompt", [...prompts].join(" "));
  }
  return url.search;
}

/**
 * The plugin's loginPage and signup.page targets (app/oauth/login,
 * app/oauth/onboarding). The plugin redirects there with the authorization
 * request's parameters plus a signature; this checks the signature, turns the
 * parameters back into an /api/oauth/authorize URL, and hands that to the
 * existing page as its callbackUrl. The page finishes by navigating to it,
 * the authorize request runs again, and the onboarding gate re-checks.
 *
 * The signature only proves the parameters came from the plugin: the
 * callbackUrl is always this origin's authorize endpoint, and authorize
 * re-validates the client, redirect_uri and session itself.
 */
export async function redirectToPageWithAuthorizeCallback(
  request: Request,
  page: "/login/email" | "/onboarding",
): Promise<Response> {
  if (!env.AUTH_USE_BETTER_AUTH) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const auth = await getAuth();
  const { secret } = await auth.$context;
  const query = new URL(request.url).searchParams;
  if (!(await verifyOAuthQueryParams(query.toString(), secret))) {
    return NextResponse.json(
      {
        error: "invalid_request",
        error_description: "Invalid or expired authorization request",
      },
      { status: 400 },
    );
  }

  const params = new URLSearchParams(query);
  for (const name of STRIPPED_PARAMS) params.delete(name);
  const prompts = (params.get("prompt") ?? "").split(" ").filter(Boolean);
  const prompt = prompts.filter((value) => !SATISFIED_PROMPTS.has(value));
  if (prompt.length > 0) params.set("prompt", prompt.join(" "));
  else params.delete("prompt");
  // A forced fresh login is replaced by the marker, so the sign-in doesn't
  // loop on max_age/prompt=login but still has to be a new one.
  if (
    page === "/login/email" &&
    (prompts.includes("login") || params.has("max_age"))
  ) {
    params.delete("max_age");
    params.set(LOGIN_MARKER_PARAM, await signLoginMarker(auth, Date.now()));
  }

  const publicUrl = env.NEXT_PUBLIC_AUTH_URL;
  const target = new URL(page, publicUrl);
  target.searchParams.set(
    "callbackUrl",
    `${publicUrl}/api/oauth/authorize?${params.toString()}`,
  );
  return NextResponse.redirect(target);
}

/**
 * Glue between the stable /api/oauth/* URLs relying parties hardcode
 * (packages/sso, sso-next, Digital Weinke's logout) and Better Auth's own
 * OAuth endpoints under /api/auth2/oauth2/*. Only used while
 * AUTH_USE_BETTER_AUTH is on; each route checks the flag itself and keeps
 * its hand-rolled code path for when it's off.
 */
import { NextResponse } from "next/server";

import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";

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
  options: { dropCookies?: boolean; body?: string } = {},
): Promise<Response> {
  const auth = await getAuth();
  const target = new URL(
    `${BETTER_AUTH_BASE_PATH}/oauth2/${endpoint}`,
    env.NEXT_PUBLIC_AUTH_URL,
  );
  target.search = new URL(request.url).search;

  const headers = new Headers(request.headers);
  if (options.dropCookies) headers.delete("cookie");

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return auth.handler(
    new Request(target, {
      method: request.method,
      headers,
      body: hasBody ? (options.body ?? (await request.text())) : undefined,
    }),
  );
}

// The plugin's own signing parameters, plus max_age: the user is about to
// sign in afresh (or already has, for onboarding), and a short max_age would
// otherwise send them straight back to the login page.
const STRIPPED_PARAMS = [
  "sig",
  "exp",
  "ba_iat",
  "ba_pl",
  "ba_param",
  "max_age",
];
// Already satisfied by the page the user is sent to. Left in, the plugin
// would redirect to that page again on every pass.
const SATISFIED_PROMPTS = new Set(["login", "create"]);

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
  const prompt = (params.get("prompt") ?? "")
    .split(" ")
    .filter((value) => value && !SATISFIED_PROMPTS.has(value))
    .join(" ");
  if (prompt) params.set("prompt", prompt);
  else params.delete("prompt");

  const publicUrl = env.NEXT_PUBLIC_AUTH_URL;
  const target = new URL(page, publicUrl);
  target.searchParams.set(
    "callbackUrl",
    `${publicUrl}/api/oauth/authorize?${params.toString()}`,
  );
  return NextResponse.redirect(target);
}

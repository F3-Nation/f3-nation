import type { NextRequest } from "next/server";
import { handleCallbackRoute } from "@f3nation/sso-next";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  OAUTH_CSRF_COOKIE_NAME,
  OAUTH_CODE_VERIFIER_COOKIE_NAME,
  ACCESS_TOKEN_DEFAULT_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
} from "@/lib/auth/constants";
import { sso } from "@/lib/auth/oauth";
import { logError, logInfo, logWarn } from "@/lib/logging";

const COOKIE_NAMES = {
  accessToken: ACCESS_TOKEN_COOKIE_NAME,
  refreshToken: REFRESH_TOKEN_COOKIE_NAME,
  oauthCsrf: OAUTH_CSRF_COOKIE_NAME,
  oauthCodeVerifier: OAUTH_CODE_VERIFIER_COOKIE_NAME,
};

function getPublicOrigin(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL is not configured");
  return siteUrl.replace(/\/+$/, "");
}

export async function GET(request: NextRequest) {
  const publicOrigin = getPublicOrigin();

  return handleCallbackRoute(request, {
    adapter: {
      exchangeCodeForToken: async (params) => {
        try {
          const tokens = await sso.exchangeCodeForToken(params);
          logInfo("me.auth.callback.token_exchange_success", {});
          return tokens;
        } catch (err) {
          logError("me.auth.callback.token_exchange_failed", {}, err);
          throw err;
        }
      },
      getUserInfo: async (accessToken) => {
        try {
          const user = await sso.getUserInfo(accessToken);
          logInfo("me.auth.callback.userinfo_received", {
            userSub: user.sub,
            hasEmail: Boolean(user.email),
          });
          return user;
        } catch (err) {
          logError("me.auth.callback.userinfo_failed", {}, err);
          throw err;
        }
      },
    },
    cookieNames: COOKIE_NAMES,
    publicOrigin,
    errorPath: "/",
    errorReturnToParam: "redirect",
    defaultReturnTo: "/profile",
    accessTokenMaxAge: ACCESS_TOKEN_DEFAULT_MAX_AGE,
    refreshTokenMaxAge: REFRESH_TOKEN_MAX_AGE,
    validateUser: (user, returnTo) => {
      if (!user.email) {
        logWarn("me.auth.callback.user_missing_email", {
          userSub: user.sub,
          returnTo,
        });
        return false;
      }
      logInfo("me.auth.callback.success", { userSub: user.sub, returnTo });
      return true;
    },
  });
}

import type { NextRequest } from "next/server";
import { handleCallbackRoute, SSO_COOKIE_NAMES } from "@f3nation/sso-next";
import {
  ACCESS_TOKEN_DEFAULT_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
} from "@/lib/auth/constants";
import { env } from "@/env";
import { sso } from "@/lib/auth/oauth";
import { logError, logInfo, logWarn } from "@/lib/logging";

export async function GET(request: NextRequest) {
  return handleCallbackRoute(request, {
    adapter: {
      exchangeCodeForToken: async (params) => {
        try {
          const tokens = await sso.exchangeCodeForToken(params);
          if (!tokens.accessToken) throw new Error("missing_access_token");
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
    cookieNames: SSO_COOKIE_NAMES,
    publicOrigin: env.NEXT_PUBLIC_SITE_URL,
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

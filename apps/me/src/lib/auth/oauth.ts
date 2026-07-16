import { createSsoAdapter } from "@f3nation/sso-next";
import { env } from "@/env";

export const sso = createSsoAdapter(() => {
  const authServerUrl = env.AUTH_PROVIDER_URL;
  if (env.NODE_ENV === "production" && !authServerUrl.startsWith("https://")) {
    throw new Error("AUTH_PROVIDER_URL must use HTTPS in production");
  }
  return {
    clientId: env.OAUTH_CLIENT_ID,
    clientSecret: env.OAUTH_CLIENT_SECRET,
    redirectUri: env.OAUTH_REDIRECT_URI,
    authServerUrl,
  };
});

// Re-export individual helpers for files that import them by name.
export const getOAuthConfig = () => sso.getOAuthConfig();
export const getAuthorizationUrl = (
  p: Parameters<typeof sso.getAuthorizationUrl>[0],
) => sso.getAuthorizationUrl(p);
export const exchangeCodeForToken = (
  p: Parameters<typeof sso.exchangeCodeForToken>[0],
) => sso.exchangeCodeForToken(p);
export const getUserInfo = (token: string) => sso.getUserInfo(token);
export const refreshToken = (p: Parameters<typeof sso.refreshToken>[0]) =>
  sso.refreshToken(p);
export const revokeToken = (token: string) => sso.revokeToken(token);

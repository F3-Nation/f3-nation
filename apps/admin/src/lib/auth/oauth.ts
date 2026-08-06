import { createSsoAdapter } from "@f3nation/sso-next";
import { env } from "~/env";

export const sso = createSsoAdapter(() => {
  const authServerUrl = env.AUTH_PROVIDER_URL;
  if (env.NODE_ENV === "production" && !authServerUrl.startsWith("https://")) {
    throw new Error("AUTH_PROVIDER_URL must use HTTPS in production");
  }
  return {
    clientId: env.OAUTH_CLIENT_ID,
    clientSecret: env.OAUTH_CLIENT_SECRET,
    redirectUri: env.OAUTH_REDIRECT_URI,
    authServerUrl: authServerUrl,
  };
});

import { AuthClient, type AuthClientConfig } from "f3-nation-auth-sdk";

const config: AuthClientConfig = {
  client: {
    CLIENT_ID: process.env.OAUTH_CLIENT_ID!,
    CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET!,
    REDIRECT_URI: process.env.OAUTH_REDIRECT_URI!,
    AUTH_SERVER_URL: process.env.AUTH_PROVIDER_URL!,
  },
};

let _authClient: AuthClient | null = null;

export function getAuthClient(): AuthClient {
  if (!_authClient) {
    _authClient = new AuthClient(config);
  }
  return _authClient;
}

export function getOAuthConfig() {
  return getAuthClient().getOAuthConfig();
}

export async function exchangeCodeForToken(code: string) {
  return getAuthClient().exchangeCodeForToken({ code });
}

export async function getUserInfo(accessToken: string) {
  const authProviderUrl = process.env.AUTH_PROVIDER_URL!;
  const res = await fetch(`${authProviderUrl}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch user info: ${res.status}`);
  }
  return res.json() as Promise<{
    sub: string;
    email: string;
    name?: string;
  }>;
}

import { AuthClient, type AuthClientConfig } from "f3-nation-auth-sdk";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

function buildAuthConfig(): AuthClientConfig {
  return {
    client: {
      CLIENT_ID: getRequiredEnv("OAUTH_CLIENT_ID"),
      CLIENT_SECRET: getRequiredEnv("OAUTH_CLIENT_SECRET"),
      REDIRECT_URI: getRequiredEnv("OAUTH_REDIRECT_URI"),
      AUTH_SERVER_URL: getRequiredEnv("AUTH_PROVIDER_URL"),
    },
  };
}

let _authClient: AuthClient | null = null;
function getAuthClient(): AuthClient {
  if (!_authClient) {
    _authClient = new AuthClient(buildAuthConfig());
  }
  return _authClient;
}

export function getOAuthConfig() {
  return getAuthClient().getOAuthConfig();
}

export async function exchangeCodeForToken(params: {
  code: string;
  codeVerifier: string;
}) {
  const config = getAuthClient().getOAuthConfig();
  const clientSecret = getRequiredEnv("OAUTH_CLIENT_SECRET");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: config.REDIRECT_URI,
    client_id: config.CLIENT_ID,
    client_secret: clientSecret,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(`${config.AUTH_SERVER_URL}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    let errorData: Record<string, string>;
    try {
      errorData = (await response.json()) as Record<string, string>;
    } catch {
      errorData = { error: "Unknown error" };
    }
    throw new Error(
      `Token exchange failed: ${errorData.error_description || errorData.error || response.statusText}`,
    );
  }

  return response.json() as Promise<Record<string, unknown>>;
}

export async function getUserInfo(
  accessToken: string,
): Promise<{ sub: string; email: string; name?: string }> {
  const authServerUrl = getAuthClient().getOAuthConfig().AUTH_SERVER_URL;
  if (!authServerUrl) {
    throw new Error("AUTH_PROVIDER_URL is not configured");
  }

  const response = await fetch(`${authServerUrl}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as Record<string, string>;
      detail = body.error_description || body.error || body.message || detail;
    } catch {
      // use default detail
    }
    throw new Error(`Failed to fetch user info: ${detail}`);
  }

  return response.json() as Promise<{
    sub: string;
    email: string;
    name?: string;
  }>;
}

import { AuthClient } from "@acme/sso";
import type {
  AuthClientConfig,
  AuthTokens,
  AuthUser,
  OauthClient,
} from "@acme/sso";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

function buildAuthConfig(): AuthClientConfig {
  return {
    clientId: getRequiredEnv("OAUTH_CLIENT_ID"),
    clientSecret: getRequiredEnv("OAUTH_CLIENT_SECRET"),
    redirectUri: getRequiredEnv("OAUTH_REDIRECT_URI"),
    authServerUrl: getRequiredEnv("AUTH_PROVIDER_URL"),
  };
}

let _authClient: AuthClient | null = null;
function getAuthClient(): AuthClient {
  if (!_authClient) {
    _authClient = new AuthClient(buildAuthConfig());
  }
  return _authClient;
}

export function getOAuthConfig(): OauthClient {
  return getAuthClient().getOAuthConfig();
}

export function getAuthorizationUrl(params: {
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}): string {
  return getAuthClient().getAuthorizationUrl(params);
}

export async function exchangeCodeForToken(params: {
  code: string;
  codeVerifier: string;
}): Promise<AuthTokens> {
  return getAuthClient().exchangeCodeForToken({
    code: params.code,
    codeVerifier: params.codeVerifier,
  });
}

export async function getUserInfo(accessToken: string): Promise<AuthUser> {
  return getAuthClient().getUserInfo(accessToken);
}

export async function refreshToken(params: {
  refreshToken: string;
}): Promise<AuthTokens> {
  return getAuthClient().refreshToken({ refreshToken: params.refreshToken });
}

export async function revokeToken(token: string): Promise<void> {
  return getAuthClient().revokeToken(token);
}

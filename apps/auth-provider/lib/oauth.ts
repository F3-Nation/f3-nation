import {
  userRepository,
  oauthClientRepository,
  oauthAuthorizationCodeRepository,
  oauthAccessTokenRepository,
  oauthRefreshTokenRepository,
} from '@/db';
import { randomBytes, createHash } from 'crypto';
import { encodeState, decodeState } from './state-utils';

export interface OAuthClient {
  id: string;
  name: string;
  clientSecret: string;
  redirectUris: string[];
  scopes: string[];
  createdAt: Date;
  isActive: boolean;
}

export interface AuthorizationRequest {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string; // Encoded state containing CSRF token and other metadata
  code_challenge?: string;
  code_challenge_method?: string;
}

export interface TokenRequest {
  grant_type: string;
  code?: string;
  redirect_uri?: string;
  client_id: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
}

// Generate secure random tokens
export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('base64url');
}

export function generateAuthorizationState(
  csrfToken: string,
  clientId?: string,
  returnTo?: string
): string {
  return encodeState({
    csrfToken,
    ...(clientId && { clientId }),
    ...(returnTo && { returnTo }),
    timestamp: Date.now(),
  });
}

export function validateAuthorizationState(state: string): {
  csrfToken: string;
  clientId?: string;
  returnTo?: string;
} {
  try {
    const decoded = decodeState(state);
    if (!decoded.csrfToken) {
      throw new Error('Invalid state: missing csrfToken');
    }
    return decoded;
  } catch {
    throw new Error('Invalid state parameter');
  }
}

// Validate OAuth client
export async function validateClient(
  clientId: string,
  clientSecret?: string
): Promise<OAuthClient | null> {
  const client = await oauthClientRepository.findActiveById(clientId);

  if (!client) return null;

  // If client secret is provided, validate it
  if (clientSecret && client.clientSecret !== clientSecret) {
    return null;
  }

  return {
    id: client.id,
    name: client.name,
    clientSecret: client.clientSecret,
    redirectUris: JSON.parse(client.redirectUris),
    scopes: client.scopes.split(' '),
    createdAt: client.createdAt,
    isActive: client.isActive,
  };
}

// Validate redirect URI
export function validateRedirectUri(client: OAuthClient, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri);
}

// Validate scopes
export function validateScopes(client: OAuthClient, requestedScopes: string[]): boolean {
  return requestedScopes.every(scope => client.scopes.includes(scope));
}

// Create authorization code
export async function createAuthorizationCode(
  clientId: string,
  userId: number,
  redirectUri: string,
  scopes: string[],
  codeChallenge?: string,
  codeChallengeMethod?: string
): Promise<string> {
  const code = generateSecureToken();
  const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await oauthAuthorizationCodeRepository.create({
    code,
    clientId,
    userId,
    redirectUri,
    scopes: scopes.join(' '),
    codeChallenge: codeChallenge ?? null,
    codeChallengeMethod: codeChallengeMethod ?? null,
    expires,
  });

  return code;
}

// Validate and consume authorization code
export async function validateAuthorizationCode(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier?: string
): Promise<{ userId: number; scopes: string[] } | null> {
  const authCode = await oauthAuthorizationCodeRepository.findValid(code, clientId, redirectUri);

  if (!authCode) return null;

  // Validate PKCE if used
  if (authCode.codeChallenge && authCode.codeChallengeMethod) {
    if (!codeVerifier) return null;

    let challenge: string;
    if (authCode.codeChallengeMethod === 'S256') {
      challenge = createHash('sha256').update(codeVerifier).digest('base64url');
    } else if (authCode.codeChallengeMethod === 'plain') {
      challenge = codeVerifier;
    } else {
      return null;
    }

    if (challenge !== authCode.codeChallenge) return null;
  }

  // Delete the authorization code (one-time use)
  await oauthAuthorizationCodeRepository.delete(code);

  return {
    userId: authCode.userId,
    scopes: authCode.scopes.split(' '),
  };
}

// Create access token
export async function createAccessToken(
  clientId: string,
  userId: number,
  scopes: string[]
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const accessToken = generateSecureToken();
  const refreshToken = generateSecureToken();
  const expiresIn = 3600; // 1 hour
  const expires = new Date(Date.now() + expiresIn * 1000);
  const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  // Insert access token
  await oauthAccessTokenRepository.create({
    token: accessToken,
    clientId,
    userId,
    scopes: scopes.join(' '),
    expires,
  });

  // Insert refresh token
  await oauthRefreshTokenRepository.create({
    token: refreshToken,
    accessToken,
    clientId,
    userId,
    expires: refreshExpires,
  });

  return { accessToken, refreshToken, expiresIn };
}

// Validate access token
export async function validateAccessToken(
  token: string
): Promise<{ userId: number; scopes: string[]; clientId: string } | null> {
  const accessToken = await oauthAccessTokenRepository.findValid(token);

  if (!accessToken) return null;

  return {
    userId: accessToken.userId,
    scopes: accessToken.scopes.split(' '),
    clientId: accessToken.clientId,
  };
}

// Refresh access token
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  const refresh = await oauthRefreshTokenRepository.findValid(refreshToken, clientId);

  if (!refresh) return null;

  // Get the old access token to get scopes
  const oldAccessToken = await oauthAccessTokenRepository.findByToken(refresh.accessToken);

  if (!oldAccessToken) return null;

  const scopes = oldAccessToken.scopes.split(' ');

  // Delete old tokens
  await oauthAccessTokenRepository.delete(refresh.accessToken);
  await oauthRefreshTokenRepository.delete(refreshToken);

  // Create new tokens
  return await createAccessToken(clientId, refresh.userId, scopes);
}

// Get user info for token
export async function getUserInfo(userId: number, scopes: string[]) {
  const user = await userRepository.findById(userId);

  if (!user) return null;

  const userInfo: Record<string, unknown> = { sub: String(userId) };

  if (scopes.includes('profile')) {
    userInfo.name = user.f3Name;
    userInfo.picture = user.avatarUrl;
  }

  if (scopes.includes('email')) {
    userInfo.email = user.email;
    userInfo.email_verified = !!user.emailVerified;
  }

  return userInfo;
}

// Register a new OAuth client (for development/admin use)
export async function registerClient(
  name: string,
  redirectUris: string[],
  scopes: string[] = ['openid', 'profile', 'email'],
  allowedOrigin: string
): Promise<{ clientId: string; clientSecret: string }> {
  const clientId = generateSecureToken(16);
  const clientSecret = generateSecureToken(32);

  await oauthClientRepository.create({
    id: clientId,
    name,
    clientSecret,
    redirectUris: JSON.stringify(redirectUris),
    scopes: scopes.join(' '),
    allowedOrigin,
  });

  return { clientId, clientSecret };
}

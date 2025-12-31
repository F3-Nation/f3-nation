/**
 * OAuthAuthorizationCode types - Maps to auth.oauth_authorization_codes table
 */

// Row type (matches DB exactly with snake_case)
export interface OAuthAuthorizationCodeRow {
  [key: string]: unknown;
  code: string;
  client_id: string;
  user_id: number;
  redirect_uri: string;
  scopes: string;
  code_challenge: string | null;
  code_challenge_method: string | null;
  expires: Date;
  created_at: Date;
}

// Entity type (TypeScript friendly with camelCase)
export interface OAuthAuthorizationCode {
  code: string;
  clientId: string;
  userId: number;
  redirectUri: string;
  scopes: string;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  expires: Date;
  createdAt: Date;
}

// Insert type (for creating new authorization codes)
export interface OAuthAuthorizationCodeInsert {
  [key: string]: unknown;
  code: string;
  clientId: string;
  userId: number;
  redirectUri: string;
  scopes: string;
  codeChallenge?: string | null;
  codeChallengeMethod?: string | null;
  expires: Date;
}

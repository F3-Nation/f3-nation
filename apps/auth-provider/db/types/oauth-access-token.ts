/**
 * OAuthAccessToken types - Maps to auth.oauth_access_tokens table
 */

// Row type (matches DB exactly with snake_case)
export interface OAuthAccessTokenRow {
  [key: string]: unknown;
  token: string;
  client_id: string;
  user_id: number;
  scopes: string;
  expires: Date;
  created_at: Date;
}

// Entity type (TypeScript friendly with camelCase)
export interface OAuthAccessToken {
  token: string;
  clientId: string;
  userId: number;
  scopes: string;
  expires: Date;
  createdAt: Date;
}

// Insert type (for creating new access tokens)
export interface OAuthAccessTokenInsert {
  [key: string]: unknown;
  token: string;
  clientId: string;
  userId: number;
  scopes: string;
  expires: Date;
}

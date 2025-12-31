/**
 * OAuthRefreshToken types - Maps to auth.oauth_refresh_tokens table
 */

// Row type (matches DB exactly with snake_case)
export interface OAuthRefreshTokenRow {
  [key: string]: unknown;
  token: string;
  access_token: string;
  client_id: string;
  user_id: number;
  expires: Date;
  created_at: Date;
}

// Entity type (TypeScript friendly with camelCase)
export interface OAuthRefreshToken {
  token: string;
  accessToken: string;
  clientId: string;
  userId: number;
  expires: Date;
  createdAt: Date;
}

// Insert type (for creating new refresh tokens)
export interface OAuthRefreshTokenInsert {
  [key: string]: unknown;
  token: string;
  accessToken: string;
  clientId: string;
  userId: number;
  expires: Date;
}

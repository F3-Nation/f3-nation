/**
 * OAuthClient types - Maps to auth.oauth_clients table
 */

// Row type (matches DB exactly with snake_case)
export interface OAuthClientRow {
  [key: string]: unknown;
  id: string;
  name: string;
  client_secret: string;
  redirect_uris: string; // JSON array string
  allowed_origin: string;
  scopes: string; // Space-separated
  created_at: Date;
  is_active: boolean;
}

// Entity type (TypeScript friendly with camelCase)
export interface OAuthClient {
  id: string;
  name: string;
  clientSecret: string;
  redirectUris: string; // JSON array string (parsed in service layer)
  allowedOrigin: string;
  scopes: string; // Space-separated (parsed in service layer)
  createdAt: Date;
  isActive: boolean;
}

// Insert type (for creating new clients)
export interface OAuthClientInsert {
  [key: string]: unknown;
  id: string;
  name: string;
  clientSecret: string;
  redirectUris: string;
  allowedOrigin: string;
  scopes?: string;
  isActive?: boolean;
}

// Update type
export interface OAuthClientUpdate {
  [key: string]: unknown;
  name?: string;
  clientSecret?: string;
  redirectUris?: string;
  allowedOrigin?: string;
  scopes?: string;
  isActive?: boolean;
}

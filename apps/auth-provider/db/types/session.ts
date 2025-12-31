/**
 * Session types - Maps to auth.sessions table
 */

// Row type (matches DB exactly with snake_case)
export interface SessionRow {
  [key: string]: unknown;
  session_token: string;
  user_id: number;
  expires: Date;
}

// Entity type (TypeScript friendly with camelCase)
export interface Session {
  sessionToken: string;
  userId: number;
  expires: Date;
}

// Insert type (for creating new sessions)
export interface SessionInsert {
  [key: string]: unknown;
  sessionToken: string;
  userId: number;
  expires: Date;
}

// Update type
export interface SessionUpdate {
  [key: string]: unknown;
  expires?: Date;
}

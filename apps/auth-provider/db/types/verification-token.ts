/**
 * VerificationToken types - Maps to auth.verification_tokens table
 */

// Row type (matches DB exactly with snake_case)
export interface VerificationTokenRow {
  [key: string]: unknown;
  identifier: string;
  token: string;
  expires: Date;
}

// Entity type (TypeScript friendly with camelCase)
// Note: This table uses snake_case that matches camelCase
export interface VerificationToken {
  identifier: string;
  token: string;
  expires: Date;
}

// Insert type (for creating new tokens)
export interface VerificationTokenInsert {
  [key: string]: unknown;
  identifier: string;
  token: string;
  expires: Date;
}

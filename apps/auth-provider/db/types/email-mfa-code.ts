/**
 * EmailMfaCode types - Maps to auth.email_mfa_codes table
 */

// Row type (matches DB exactly with snake_case)
export interface EmailMfaCodeRow {
  [key: string]: unknown;
  id: string;
  email: string;
  code_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  attempt_count: number;
  created_at: Date;
}

// Entity type (TypeScript friendly with camelCase)
export interface EmailMfaCode {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
  createdAt: Date;
}

// Insert type (for creating new MFA codes)
export interface EmailMfaCodeInsert {
  [key: string]: unknown;
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  attemptCount?: number;
}

// Update type
export interface EmailMfaCodeUpdate {
  [key: string]: unknown;
  consumedAt?: Date | null;
  attemptCount?: number;
}

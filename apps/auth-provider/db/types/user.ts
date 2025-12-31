/**
 * User types - Maps to public.users table
 */

// Row type (matches DB exactly with snake_case)
export interface UserRow {
  [key: string]: unknown;
  id: number;
  f3_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  home_region_id: number | null;
  avatar_url: string | null;
  meta: string | null;
  created: Date | null;
  updated: Date | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  emergency_notes: string | null;
  email_verified: Date | null;
  status: 'active' | 'inactive' | null;
}

// Entity type (TypeScript friendly with camelCase)
export interface User {
  id: number;
  f3Name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  homeRegionId: number | null;
  avatarUrl: string | null;
  meta: string | null;
  created: Date | null;
  updated: Date | null;
  emergencyContact: string | null;
  emergencyPhone: string | null;
  emergencyNotes: string | null;
  emailVerified: Date | null;
  status: 'active' | 'inactive' | null;
}

// Insert type (for creating new users)
export interface UserInsert {
  [key: string]: unknown;
  f3Name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  homeRegionId?: number | null;
  avatarUrl?: string | null;
  meta?: string | null;
  emergencyContact?: string | null;
  emergencyPhone?: string | null;
  emergencyNotes?: string | null;
  emailVerified?: Date | null;
  status?: 'active' | 'inactive';
}

// Update type (all fields optional)
export interface UserUpdate {
  [key: string]: unknown;
  f3Name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  homeRegionId?: number | null;
  avatarUrl?: string | null;
  meta?: string | null;
  emergencyContact?: string | null;
  emergencyPhone?: string | null;
  emergencyNotes?: string | null;
  emailVerified?: Date | null;
  status?: 'active' | 'inactive';
  updated?: Date;
}

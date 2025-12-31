/**
 * UserProfile types - Maps to auth.user_profiles table
 */

// Row type (matches DB exactly with snake_case)
export interface UserProfileRow {
  [key: string]: unknown;
  user_id: number;
  hospital_name: string | null;
  onboarding_completed: boolean;
  created_at: Date;
  updated_at: Date;
}

// Entity type (TypeScript friendly with camelCase)
export interface UserProfile {
  userId: number;
  hospitalName: string | null;
  onboardingCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Insert type (for creating new profiles)
export interface UserProfileInsert {
  [key: string]: unknown;
  userId: number;
  hospitalName?: string | null;
  onboardingCompleted?: boolean;
}

// Update type (all fields optional except key)
export interface UserProfileUpdate {
  [key: string]: unknown;
  hospitalName?: string | null;
  onboardingCompleted?: boolean;
  updatedAt?: Date;
}

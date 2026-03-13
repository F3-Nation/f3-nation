/** User profile as returned by the F3 API */
export interface UserProfile {
  id: number;
  f3Name: string;
  firstName: string | null;
  lastName: string;
  email: string;
  phone: string | null;
  homeRegionId: number | null;
  avatarUrl: string | null;
  meta: Record<string, unknown> | string | null;
  emergencyContact: string | null;
  emergencyPhone: string | null;
  emergencyNotes: string | null;
  status: "active" | "inactive";
  roles: UserRole[];
  created: string;
  updated: string;
}

export interface UserRole {
  orgId: number;
  roleName: "user" | "editor" | "admin";
  orgName?: string;
}

/** Parsed meta fields that users can edit */
export interface UserMeta {
  f3_name_origin?: string;
  my_f3_why?: string;
  user_emergency_info_dr_sharing?: boolean;
  start_date_override?: string;
  [key: string]: unknown;
}

export interface Region {
  id: number;
  name: string;
  orgType: string;
  isActive: boolean;
}

export interface PositionAssignment {
  positionId: number;
  positionName: string;
  userIds: number[];
}

export interface OrgPositionAssignments {
  orgId: number;
  assignments: PositionAssignment[];
}

/** Body for user upsert (POST /v1/user) */
export interface UserUpsert {
  id: number;
  f3Name?: string;
  firstName?: string | null;
  lastName?: string;
  email?: string;
  phone?: string;
  homeRegionId?: number | null;
  avatarUrl?: string | null;
  meta?: Record<string, unknown>;
  emergencyContact?: string | null;
  emergencyPhone?: string | null;
  emergencyNotes?: string | null;
  status?: "active" | "inactive";
  roles?: { orgId: number; roleName: "user" | "editor" | "admin" }[];
}

/** Fields editable on the profile form */
export interface ProfileUpdatePayload {
  f3Name?: string;
  firstName?: string | null;
  lastName?: string;
  phone?: string;
  homeRegionId?: number | null;
  avatarUrl?: string | null;
  emergencyContact?: string | null;
  emergencyPhone?: string | null;
  emergencyNotes?: string | null;
  // Meta sub-fields (handled separately)
  f3_name_origin?: string;
  my_f3_why?: string;
  user_emergency_info_dr_sharing?: boolean;
  start_date_override?: string;
}

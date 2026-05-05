/** User profile as returned by the /me/profile endpoint */
export interface UserProfile {
  id: number;
  f3Name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  emailVerified: string | null;
  phone: string | null;
  homeRegionId: number | null;
  avatarUrl: string | null;
  meta: Record<string, unknown> | string | null;
  emergencyContact: string | null;
  emergencyPhone: string | null;
  emergencyNotes: string | null;
  status: "active" | "inactive";
  roles: UserRole[];
  positions: UserPosition[];
  created: string;
  updated: string;
}

export interface UserRole {
  roleId: number;
  orgId: number;
  roleName: "user" | "editor" | "admin";
  orgName: string;
}

export interface UserPosition {
  positionId: number;
  orgId: number;
  positionName: string;
  orgName: string;
}

/** Parsed meta fields that users can edit */
export interface UserMeta {
  f3_name_origin?: string;
  my_f3_why?: string;
  user_emergency_info_dr_sharing?: boolean;
  start_date_override?: string;
  brought_by?: number | null;
  [key: string]: unknown;
}

export interface Region {
  id: number;
  name: string;
  isActive: boolean;
}

/** Lightweight user record for the "Who Brought You?" dropdown */
export interface UserListItem {
  id: number;
  f3Name: string | null;
  firstName: string | null;
  lastName: string | null;
  homeRegionId: number | null;
  homeRegionName: string | null;
  status: "active" | "inactive";
}

/** Fields editable on the profile form */
export interface ProfileUpdatePayload {
  f3Name?: string;
  firstName?: string | null;
  lastName?: string;
  phone?: string | null;
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
  brought_by?: number | null;
}

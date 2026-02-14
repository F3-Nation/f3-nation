/**
 * Attendance Type Constants
 *
 * Maps to attendance_type table in the database.
 * These IDs are stable and used throughout the codebase.
 */

export const ATTENDANCE_TYPES = {
  /** General attendee / HC (Head Count) */
  PAX: 1,
  /** Primary Q (workout leader) */
  Q: 2,
  /** Co-Q (assistant workout leader) */
  COQ: 3,
} as const;

export type AttendanceTypeId =
  (typeof ATTENDANCE_TYPES)[keyof typeof ATTENDANCE_TYPES];

/**
 * Check if an attendance type ID indicates a Q role (Q or Co-Q)
 */
export function isQRole(typeId: number): boolean {
  return typeId === ATTENDANCE_TYPES.Q || typeId === ATTENDANCE_TYPES.COQ;
}

/**
 * Get display name for an attendance type
 */
export function getAttendanceTypeName(typeId: number): string {
  switch (typeId) {
    case ATTENDANCE_TYPES.PAX:
      return "PAX";
    case ATTENDANCE_TYPES.Q:
      return "Q";
    case ATTENDANCE_TYPES.COQ:
      return "Co-Q";
    default:
      return "Unknown";
  }
}

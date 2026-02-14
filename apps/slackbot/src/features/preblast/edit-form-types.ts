/**
 * Preblast Edit Form Types
 *
 * Types and interfaces for the preblast edit form feature.
 */

import type { NavigationMetadata } from "../../types/bolt-types";
import type {
  AttendanceRecord,
  EventInstanceResponse,
  LocationResponse,
} from "../../types/api-types";

/**
 * Metadata stored in the preblast edit modal's private_metadata
 */
export interface PreblastEditMetadata extends NavigationMetadata {
  /** Event instance ID being edited */
  eventInstanceId: number;
  /** Existing preblast timestamp (if already posted) */
  preblastTs?: string | null;
}

/**
 * Preblast info data structure
 * Contains all data needed to render the preblast form or display
 */
export interface PreblastInfo {
  /** The event instance record */
  eventRecord: EventInstanceResponse & {
    preblast?: string | null;
    preblastRich?: Record<string, unknown> | null;
    preblastTs?: number | null;
    location?: LocationResponse | null;
    org?: {
      id: number;
      name: string;
      meta?: Record<string, string> | null;
    };
  };
  /** All attendance records for the event */
  attendanceRecords: AttendanceRecord[];
  /** Whether the current user is Q or Co-Q */
  userIsQ: boolean;
  /** Current user's ID (F3 user ID) */
  currentUserId: number | null;
  /** Formatted Q list for display (e.g., "<@U123> <@U456>") */
  qListDisplay: string;
  /** Formatted HC list for display */
  hcListDisplay: string;
  /** HC count (unique users) */
  hcCount: number;
  /** Map of attendance record to Slack user ID (for this team) */
  attendanceSlackDict: Map<number, string | null>;
}

/**
 * Form field values from the preblast edit form
 */
export interface PreblastFormValues {
  title: string;
  locationId?: string | null;
  startTime: string;
  coQs?: string[] | null;
  tagId?: string | null;
  moleskine: Record<string, unknown>;
  sendOption: "Send now" | "Send a day before the event";
  updateMode?: "Update preblast" | "Repost preblast";
}

/**
 * Result from sending/updating a preblast
 */
export interface SendPreblastResult {
  success: boolean;
  messageTs?: string;
  channel?: string;
  error?: string;
}

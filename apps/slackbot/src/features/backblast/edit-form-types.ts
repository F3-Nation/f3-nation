/**
 * Backblast Edit Form Types
 *
 * Types and interfaces for the backblast edit form feature.
 */

import type { NavigationMetadata } from "../../types/bolt-types";
import type {
  AttendanceRecord,
  EventInstanceResponse,
  LocationResponse,
} from "../../types/api-types";

/**
 * Metadata stored in the backblast edit modal's private_metadata
 */
export interface BackblastEditMetadata extends NavigationMetadata {
  /** Event instance ID being edited (undefined for unscheduled backblasts) */
  eventInstanceId?: number;
  /** Existing backblast message timestamp (if already posted) */
  backblastTs?: string | null;
  /** Whether this is an unscheduled (non-calendar) backblast */
  isUnscheduled?: boolean;
  /** Original poster's Slack ID (for edit permission checking) */
  originalPoster?: string;
}

/**
 * Backblast info data structure
 * Contains all data needed to render the backblast form or display
 */
export interface BackblastInfo {
  /** The event instance record */
  eventRecord: EventInstanceResponse & {
    backblast?: string | null;
    backblastRich?: Record<string, unknown>[] | null;
    backblastTs?: number | null;
    preblastTs?: number | null;
    location?: LocationResponse | null;
    paxCount?: number | null;
    fngCount?: number | null;
    org?: {
      id: number;
      name: string;
      meta?: Record<string, string> | null;
    };
  };
  /** All attendance records for the event (both planned and actual) */
  attendanceRecords: AttendanceRecord[];
  /** Whether the current user is Q or Co-Q */
  userIsQ: boolean;
  /** Whether the current user is the original poster */
  userIsOriginalPoster: boolean;
  /** Current user's ID (F3 user ID) */
  currentUserId: number | null;
  /** Formatted Q display (e.g., "<@U123>") */
  qDisplay: string;
  /** Q's Slack ID */
  qSlackId: string | null;
  /** Formatted Co-Q list (e.g., "<@U456> <@U789>") */
  coQDisplay: string;
  /** Co-Q Slack IDs */
  coQSlackIds: string[];
  /** Formatted PAX list for display */
  paxDisplay: string;
  /** PAX Slack IDs */
  paxSlackIds: string[];
  /** Map of attendance record ID to Slack user ID (for this team) */
  attendanceSlackDict: Map<number, string | null>;
  /** Non-Slack attendance records (downrange PAX with no Slack link) */
  nonSlackAttendance: AttendanceRecord[];
}

/**
 * Form field values from the backblast edit form
 */
export interface BackblastFormValues {
  /** Backblast title */
  title: string;
  /** Q user's Slack ID */
  q: string;
  /** Co-Q users' Slack IDs */
  coQs: string[];
  /** PAX users' Slack IDs */
  pax: string[];
  /** Downrange PAX user IDs (F3 user IDs, not Slack IDs) */
  downrangePax: number[];
  /** Non-Slack PAX names (comma-separated text) */
  nonSlackPax: string;
  /** FNG names (comma-separated text) */
  fngs: string;
  /** Total PAX count (optional, auto-calculated if not provided) */
  count: number | null;
  /** Moleskine rich text content */
  moleskine: Record<string, unknown>;
  /** Selected options (e.g., "exclude_from_pax_vault") */
  options: string[];
  /** Email send option ("yes" | "no") */
  emailSend: "yes" | "no";
  /** Send timing ("Send now" | "Save and send later") */
  sendOption: "Send now" | "Save and send later";
  /** File URLs (uploaded boyband images) */
  files: string[];
  /** File IDs from Slack (before upload to storage) */
  slackFileIds: string[];
  // Unscheduled event fields
  /** Workout date (for unscheduled events) */
  date?: string;
  /** AO org ID (for unscheduled events) */
  aoId?: number;
  /** Event type ID */
  eventTypeId?: number;
}

/**
 * Custom field definition from region settings
 * Matches the CustomField type from types/index.ts
 */
export interface CustomFieldDefinition {
  name: string;
  type: "text" | "select" | "multi_select";
  options?: string[];
  enabled: boolean;
}

/**
 * Result from sending/updating a backblast
 */
export interface SendBackblastResult {
  success: boolean;
  messageTs?: string;
  channel?: string;
  error?: string;
}

/**
 * Data stored in backblast message metadata
 * Note: Arrays are stored as comma-separated strings for Slack API compatibility
 */
export interface BackblastMessageMetadata {
  event_instance_id: number;
  original_poster: string;
  q: string;
  coQs?: string; // comma-separated
  files?: string; // comma-separated
  file_ids?: string; // comma-separated
}

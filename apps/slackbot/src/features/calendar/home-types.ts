/**
 * Calendar Home Types
 *
 * Type definitions for the calendar home schedule view.
 */

/**
 * Event type info for calendar display
 */
export interface CalendarEventType {
  id: number;
  name: string;
}

/**
 * Calendar home event from the API
 * Includes attendance aggregation and user status
 */
export interface CalendarHomeEvent {
  id: number;
  name: string;
  startDate: string;
  startTime: string | null;
  orgId: number;
  orgName: string | null;
  seriesId: number | null;
  seriesName: string | null;
  hasPreblast: boolean;
  eventTypes: CalendarEventType[];
  /** Comma-separated Q names, null if no Q assigned */
  plannedQs: string | null;
  /** Whether the current user has any planned attendance */
  userAttending: boolean;
  /** Whether the current user is Q or Co-Q */
  userIsQ: boolean;
}

/**
 * Response from calendarHomeSchedule API endpoint
 */
export interface CalendarHomeScheduleResponse {
  events: CalendarHomeEvent[];
}

/**
 * Filter state for calendar home view
 * Stored in private_metadata for persistence across updates
 */
export interface CalendarHomeFilterState {
  /** AO org IDs to filter by */
  aoOrgIds?: number[];
  /** Event type IDs to filter by */
  eventTypeIds?: number[];
  /** Start date for filtering (YYYY-MM-DD) */
  startDate?: string;
  /** Show only events with no Q assigned */
  openQOnly?: boolean;
  /** Show only events the user is attending */
  onlyUserEvents?: boolean;
}

/**
 * Metadata stored in calendar home modal's private_metadata
 */
export interface CalendarHomeMetadata {
  /** Whether the user has admin privileges */
  userIsAdmin?: boolean;
  /** Current filter state */
  filters?: CalendarHomeFilterState;
}

/**
 * Available actions in the calendar home event overflow menu
 */
export type CalendarHomeEventAction =
  | "View Preblast"
  | "Edit Preblast"
  | "Take Q"
  | "HC"
  | "Un-HC"
  | "Assign Q"
  | "Edit Backblast"
  | "View Backblast"
  | "Take Myself Off Q";

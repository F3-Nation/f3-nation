/**
 * Types for backblast feature
 */

import type { PastQEvent, EventWithoutQ } from "../../types/api-types";
import type { NavigationMetadata } from "../../types/bolt-types";

/**
 * Metadata stored in the backblast selection modal's private_metadata
 */
export interface BackblastSelectMetadata extends NavigationMetadata {
  /** Selected event instance ID (if any) */
  eventInstanceId?: number;
}

/**
 * Props for building the backblast selection form
 */
export interface BackblastSelectFormProps {
  /** User's past Q events (events where they were Q or Co-Q) */
  pastQs: PastQEvent[];
  /** Events without any Q assigned */
  eventsWithoutQ: EventWithoutQ[];
  /** Current navigation depth */
  navDepth: number;
}

/**
 * Action value encoded in button values for quick-select
 */
export interface BackblastFillButtonValue {
  eventInstanceId: number;
}

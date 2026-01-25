/**
 * Types for preblast feature
 */

import type { UpcomingQEvent } from "../../types/api-types";
import type { NavigationMetadata } from "../../types/bolt-types";

/**
 * Metadata stored in the preblast selection modal's private_metadata
 */
export interface PreblastSelectMetadata extends NavigationMetadata {
  /** Selected event instance ID (if any) */
  eventInstanceId?: number;
}

/**
 * Props for building the preblast selection form
 */
export interface PreblastSelectFormProps {
  /** User's upcoming Q events (events where they are Q or Co-Q) */
  upcomingQs: UpcomingQEvent[];
  /** Current navigation depth */
  navDepth: number;
}

/**
 * Action value encoded in button values for quick-select
 */
export interface PreblastFillButtonValue {
  eventInstanceId: number;
}

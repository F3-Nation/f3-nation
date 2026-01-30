/**
 * Assign Q Modal
 *
 * Modal for assigning a Q (primary leader) and Co-Qs to an event.
 * Only accessible by admins.
 */

import type { ModalView } from "@slack/types";

import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import type { NavigationMetadata } from "../../types/bolt-types";

export interface AssignQMetadata {
  eventInstanceId: number;
  eventInstanceName: string;
  eventInstanceDate: string;
  aoName: string;
  startTime?: string;
}

export interface AssignQBuildOptions {
  eventInstanceId: number;
  teamId: string;
}

/**
 * Format date for display: "Monday, January 29"
 */
function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * Build the Assign Q modal view
 */
export async function buildAssignQModal(
  options: AssignQBuildOptions,
  navMetadata: NavigationMetadata,
): Promise<ModalView> {
  const { eventInstanceId, teamId } = options;

  // Fetch event instance details
  const event = await api.eventInstance.byId({ id: eventInstanceId });

  if (!event) {
    throw new Error(`Event instance ${eventInstanceId} not found`);
  }

  // Fetch existing Q and Co-Q attendance
  const attendanceResult = await api.attendance.getForEventInstance({
    eventInstanceId,
    isPlanned: true,
  });

  // Find existing Q and Co-Qs
  let existingQSlackId: string | undefined;
  const existingCoQSlackIds: string[] = [];

  for (const record of attendanceResult.attendance) {
    const isQ = record.attendanceTypes?.some((t) => t.type === "Q");
    const isCoQ = record.attendanceTypes?.some((t) => t.type === "Co-Q");

    // Get the user's slack ID for this team
    const slackUser = record.slackUsers?.find(
      (su) => su.slackTeamId === teamId,
    );

    if (slackUser?.slackId) {
      if (isQ) {
        existingQSlackId = slackUser.slackId;
      }
      if (isCoQ) {
        existingCoQSlackIds.push(slackUser.slackId);
      }
    }
  }

  // Build event info header
  const aoName = event.org?.name ?? "Unknown AO";
  const eventName = event.name ?? "Event";
  const eventDate = formatDateDisplay(event.startDate);
  const startTime = event.startTime ?? "TBD";

  const headerText =
    `*AO:* ${aoName}\n` +
    `*Event:* ${eventName}\n` +
    `*Date:* ${eventDate}\n` +
    `*Start Time:* ${startTime}`;

  // Store metadata for form submission
  const assignQMetadata: AssignQMetadata = {
    eventInstanceId,
    eventInstanceName: eventName,
    eventInstanceDate: eventDate,
    aoName,
    startTime,
  };

  const privateMetadata = JSON.stringify({
    ...navMetadata,
    assignQ: assignQMetadata,
  });

  const blocks: ModalView["blocks"] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: headerText,
      },
    },
    {
      type: "divider",
    },
    {
      type: "input",
      block_id: "q_user_block",
      label: {
        type: "plain_text",
        text: "Select Q",
      },
      element: {
        type: "multi_users_select",
        action_id: ACTIONS.ASSIGN_Q_USER,
        placeholder: {
          type: "plain_text",
          text: "Select a user to assign as Q",
        },
        max_selected_items: 1,
        ...(existingQSlackId ? { initial_users: [existingQSlackId] } : {}),
      },
      optional: true,
    },
    {
      type: "input",
      block_id: "co_qs_block",
      label: {
        type: "plain_text",
        text: "Select Co-Qs (optional)",
      },
      element: {
        type: "multi_users_select",
        action_id: ACTIONS.ASSIGN_Q_CO_QS,
        placeholder: {
          type: "plain_text",
          text: "Select users to assign as Co-Qs",
        },
        ...(existingCoQSlackIds.length > 0
          ? { initial_users: existingCoQSlackIds }
          : {}),
      },
      optional: true,
    },
  ];

  return {
    type: "modal",
    callback_id: ACTIONS.ASSIGN_Q_CALLBACK_ID,
    private_metadata: privateMetadata,
    title: {
      type: "plain_text",
      text: "Assign Q",
    },
    submit: {
      type: "plain_text",
      text: "Assign Q",
    },
    close: {
      type: "plain_text",
      text: "Cancel",
    },
    blocks,
  };
}

/**
 * Extract form values from the Assign Q modal submission
 */
export function extractAssignQValues(
  values: Record<string, Record<string, unknown>>,
): { qSlackId?: string; coQSlackIds: string[] } {
  // Q user selection
  const qUserBlock = values.q_user_block?.[ACTIONS.ASSIGN_Q_USER] as
    | { selected_users?: string[] }
    | undefined;
  const qSlackId = qUserBlock?.selected_users?.[0];

  // Co-Qs selection
  const coQsBlock = values.co_qs_block?.[ACTIONS.ASSIGN_Q_CO_QS] as
    | { selected_users?: string[] }
    | undefined;
  const coQSlackIds = coQsBlock?.selected_users ?? [];

  return { qSlackId, coQSlackIds };
}

/**
 * Parse Assign Q metadata from private_metadata
 */
export function parseAssignQMetadata(privateMetadata: string | undefined): {
  navMetadata: NavigationMetadata;
  assignQ?: AssignQMetadata;
} {
  if (!privateMetadata) {
    return { navMetadata: { _navDepth: 0 } };
  }

  try {
    const parsed = JSON.parse(privateMetadata) as {
      _navDepth?: number;
      _parentViewId?: string;
      assignQ?: AssignQMetadata;
    };
    return {
      navMetadata: {
        _navDepth: parsed._navDepth ?? 0,
        _parentViewId: parsed._parentViewId,
      },
      assignQ: parsed.assignQ,
    };
  } catch {
    return { navMetadata: { _navDepth: 0 } };
  }
}

/**
 * Preblast Edit Form Builder
 *
 * Builds the modal for editing and sending preblasts.
 * Shows edit form for Q users, read-only view for others.
 */

import type { ModalView, View } from "@slack/types";

import { ACTIONS } from "../../constants/actions";
import { ATTENDANCE_TYPES, isQRole } from "../../constants/attendance-types";
import { api } from "../../lib/api-client";
import {
  formatDateDisplay,
  formatTimeDisplay,
  getLocationDisplayName,
  normalizeTimeForPicker,
  getCurrentDateCST,
} from "../../lib/helpers";
import { logger } from "../../lib/logger";
import { stringifyNavMetadata } from "../../types/bolt-types";
import type { NavigationMetadata } from "../../types/bolt-types";
import type { LocationResponse } from "../../types/api-types";
import type { PreblastEditMetadata, PreblastInfo } from "./edit-form-types";

/** Default preblast template when none is configured */
const DEFAULT_PREBLAST_TEMPLATE = {
  type: "rich_text",
  elements: [
    {
      type: "rich_text_section",
      elements: [{ text: "Enter your preblast details here...", type: "text" }],
    },
  ],
};

/**
 * Build preblast info data structure.
 * Fetches event instance and attendance data, computes display values.
 */
export async function buildPreblastInfo(
  eventInstanceId: number,
  currentUserId: number | null,
  teamId: string,
): Promise<PreblastInfo | null> {
  try {
    // Fetch event instance
    const eventRecord = await api.eventInstance.byId({ id: eventInstanceId });
    if (!eventRecord) {
      logger.error("Event instance not found", { eventInstanceId });
      return null;
    }

    // Fetch attendance records
    const { attendance: attendanceRecords } =
      await api.attendance.getForEventInstance({
        eventInstanceId,
        isPlanned: true,
      });

    // Build attendance -> Slack ID map for this team
    const attendanceSlackDict = new Map<number, string | null>();
    for (const record of attendanceRecords) {
      const slackUser = record.slackUsers.find((s) => s.slackTeamId === teamId);
      attendanceSlackDict.set(record.id, slackUser?.slackId ?? null);
    }

    // Check if current user is Q or Co-Q
    const userIsQ = currentUserId
      ? attendanceRecords.some(
          (r) =>
            r.userId === currentUserId &&
            r.attendanceTypes.some((t) => isQRole(t.id)),
        )
      : false;

    // Build Q list display string
    const qRecords = attendanceRecords.filter((r) =>
      r.attendanceTypes.some((t) => isQRole(t.id)),
    );
    const qListParts: string[] = [];
    for (const record of qRecords) {
      const slackId = attendanceSlackDict.get(record.id);
      if (slackId) {
        qListParts.push(`<@${slackId}>`);
      } else {
        qListParts.push(`@${record.user?.f3Name ?? "Unknown"}`);
      }
    }
    const qListDisplay = qListParts.length > 0 ? qListParts.join(" ") : "Open!";

    // Build HC list display string
    const hcListParts: string[] = [];
    for (const record of attendanceRecords) {
      const slackId = attendanceSlackDict.get(record.id);
      if (slackId) {
        hcListParts.push(`<@${slackId}>`);
      } else {
        hcListParts.push(`@${record.user?.f3Name ?? "Unknown"}`);
      }
    }
    const hcListDisplay =
      hcListParts.length > 0 ? hcListParts.join(" ") : "None";

    // HC count is unique users
    const uniqueUserIds = new Set(attendanceRecords.map((r) => r.userId));
    const hcCount = uniqueUserIds.size;

    return {
      eventRecord: eventRecord as PreblastInfo["eventRecord"],
      attendanceRecords,
      userIsQ,
      currentUserId,
      qListDisplay,
      hcListDisplay,
      hcCount,
      attendanceSlackDict,
    };
  } catch (error) {
    logger.error("Failed to build preblast info", { eventInstanceId, error });
    return null;
  }
}

/**
 * Get the destination channel for a preblast.
 * Checks region settings and AO channel configuration.
 */
export function getPreblastChannel(
  spaceSettings: {
    default_preblast_destination?: string | null;
    preblast_destination_channel?: string | null;
  } | null,
  preblastInfo: PreblastInfo,
): string | null {
  // Check if region has a specified destination channel
  if (
    spaceSettings?.default_preblast_destination === "specified" &&
    spaceSettings.preblast_destination_channel
  ) {
    return spaceSettings.preblast_destination_channel;
  }

  // Fall back to AO's Slack channel from org meta
  const aoChannelId = preblastInfo.eventRecord.org?.meta?.slack_channel_id;
  return typeof aoChannelId === "string" ? aoChannelId : null;
}

/**
 * Build action buttons for the preblast display.
 * Different buttons shown based on user's relationship to the event.
 */
function buildActionButtons(
  preblastInfo: PreblastInfo,
  eventInstanceId: number,
): View["blocks"] {
  const buttons: {
    type: "button";
    text: { type: "plain_text"; text: string; emoji?: boolean };
    action_id: string;
    value?: string;
    style?: "primary" | "danger";
  }[] = [];

  // Q-related buttons
  if (preblastInfo.qListDisplay === "Open!") {
    // No Q assigned - show Take Q button
    buttons.push({
      type: "button",
      text: { type: "plain_text", text: "Take Q", emoji: true },
      action_id: ACTIONS.EVENT_PREBLAST_TAKE_Q,
      value: String(eventInstanceId),
    });
  } else if (preblastInfo.userIsQ) {
    // User is Q - show Remove Q button
    buttons.push({
      type: "button",
      text: { type: "plain_text", text: "Take myself off Q", emoji: true },
      action_id: ACTIONS.EVENT_PREBLAST_REMOVE_Q,
      value: String(eventInstanceId),
    });
  }

  // HC buttons
  const userHasHC = preblastInfo.currentUserId
    ? preblastInfo.attendanceRecords.some(
        (r) => r.userId === preblastInfo.currentUserId,
      )
    : false;

  if (userHasHC) {
    if (!preblastInfo.userIsQ) {
      // User is HC but not Q - can un-HC
      buttons.push({
        type: "button",
        text: { type: "plain_text", text: "Un-HC", emoji: true },
        action_id: ACTIONS.EVENT_PREBLAST_UN_HC,
        value: String(eventInstanceId),
      });
    }
  } else {
    // User is not HC - can HC
    buttons.push({
      type: "button",
      text: { type: "plain_text", text: "HC", emoji: true },
      action_id: ACTIONS.EVENT_PREBLAST_HC,
      value: String(eventInstanceId),
      style: "primary",
    });
  }

  // Edit button for Q users
  if (preblastInfo.userIsQ) {
    buttons.push({
      type: "button",
      text: { type: "plain_text", text: ":pencil: Edit Preblast", emoji: true },
      action_id: ACTIONS.EVENT_PREBLAST_EDIT,
      value: "Edit Preblast",
    });
  }

  if (buttons.length === 0) {
    return [];
  }

  return [
    {
      type: "actions",
      elements: buttons,
    },
  ];
}

/**
 * Build preblast display blocks (read-only view).
 * Shows event details, Q list, HC list, and preblast content.
 */
function buildPreblastDisplayBlocks(
  preblastInfo: PreblastInfo,
  eventInstanceId: number,
): View["blocks"] {
  const event = preblastInfo.eventRecord;

  // Build location string
  let locationStr = "";
  const aoChannelId = event.org?.meta?.slack_channel_id;
  if (aoChannelId) {
    locationStr += `<#${aoChannelId}>`;
  }
  if (event.location) {
    const locName = getLocationDisplayName(event.location);
    if (event.location.latitude && event.location.longitude) {
      locationStr += ` - <https://www.google.com/maps/search/?api=1&query=${event.location.latitude},${event.location.longitude}|${locName}>`;
    } else {
      locationStr += ` - ${locName}`;
    }
  }

  // Build event types string
  const eventTypesStr =
    event.eventTypes?.map((t) => t.eventTypeName).join(" / ") ?? "Workout";

  // Build event tags string
  const eventTagsStr =
    event.eventTags?.map((t) => t.eventTagName).join(", ") ?? "";

  // Build event details markdown
  let eventDetails = `*Preblast: ${event.name}*`;
  eventDetails += `\n*Date:* ${formatDateDisplay(event.startDate)}`;
  eventDetails += `\n*Time:* ${formatTimeDisplay(event.startTime)}`;
  eventDetails += `\n*Where:* ${locationStr || "TBD"}`;
  eventDetails += `\n*Event Type:* ${eventTypesStr}`;
  if (eventTagsStr) {
    eventDetails += `\n*Event Tag:* ${eventTagsStr}`;
  }
  eventDetails += `\n*Q:* ${preblastInfo.qListDisplay}`;
  eventDetails += `\n*HC Count:* ${preblastInfo.hcCount}`;
  eventDetails += `\n*HCs:* ${preblastInfo.hcListDisplay}`;

  const blocks: View["blocks"] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: eventDetails,
      },
    },
  ];

  // Add preblast content if available
  const preblastRich =
    (event as { preblastRich?: Record<string, unknown> }).preblastRich ??
    DEFAULT_PREBLAST_TEMPLATE;
  blocks.push({
    type: "rich_text",
    elements: (preblastRich as { elements?: unknown[] }).elements ?? [],
  } as View["blocks"][number]);

  // Add action buttons
  blocks.push(...buildActionButtons(preblastInfo, eventInstanceId));

  return blocks;
}

/**
 * Build the preblast edit form (for Q users).
 */
async function buildPreblastEditFormBlocks(
  preblastInfo: PreblastInfo,
  spaceSettings: {
    preblast_moleskin_template?: string | null;
    default_preblast_destination?: string | null;
    preblast_destination_channel?: string | null;
  } | null,
  regionOrgId: number,
): Promise<View["blocks"]> {
  const event = preblastInfo.eventRecord;

  // Fetch locations for the dropdown
  let locationOptions: {
    text: { type: "plain_text"; text: string };
    value: string;
  }[] = [];
  try {
    const { locations } = await api.location.all({ regionIds: [regionOrgId] });
    locationOptions = locations.map((loc: LocationResponse) => ({
      text: { type: "plain_text" as const, text: getLocationDisplayName(loc) },
      value: String(loc.id),
    }));
  } catch (error) {
    logger.warn("Failed to fetch locations", error);
  }

  // Fetch event tags for the dropdown
  let tagOptions: {
    text: { type: "plain_text"; text: string };
    value: string;
  }[] = [];
  try {
    const { eventTags } = await api.eventTag.all({
      orgIds: [regionOrgId],
      statuses: ["active"],
    });
    tagOptions = eventTags
      .filter((tag) => tag.name !== "Open")
      .map((tag) => ({
        text: { type: "plain_text" as const, text: tag.name },
        value: String(tag.id),
      }));
  } catch (error) {
    logger.warn("Failed to fetch event tags", error);
  }

  // Determine default send option based on event date
  const today = getCurrentDateCST();
  const eventDate = event.startDate;
  const daysDiff = Math.floor(
    (new Date(eventDate).getTime() - new Date(today).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  const scheduleDefault =
    daysDiff >= 1 && !(event as { preblastTs?: number | null }).preblastTs
      ? "Send a day before the event"
      : "Send now";

  // Get initial values
  const initialTitle = event.name;
  // Parse template from string if needed
  let templateBlock: Record<string, unknown> | null = null;
  if (spaceSettings?.preblast_moleskin_template) {
    try {
      templateBlock = JSON.parse(
        spaceSettings.preblast_moleskin_template,
      ) as Record<string, unknown>;
    } catch {
      // Not valid JSON, ignore
    }
  }
  const initialMoleskine =
    (event as { preblastRich?: Record<string, unknown> }).preblastRich ??
    templateBlock ??
    DEFAULT_PREBLAST_TEMPLATE;
  const initialTime = normalizeTimeForPicker(event.startTime);
  const initialLocationId = event.locationId
    ? String(event.locationId)
    : undefined;
  const initialTagId = event.eventTags?.[0]?.eventTagId
    ? String(event.eventTags[0].eventTagId)
    : undefined;

  // Get Co-Qs (attendance with type 3)
  const coQSlackIds: string[] = [];
  for (const record of preblastInfo.attendanceRecords) {
    const isCoQ = record.attendanceTypes.some(
      (t) => t.id === ATTENDANCE_TYPES.COQ,
    );
    if (isCoQ) {
      const slackId = preblastInfo.attendanceSlackDict.get(record.id);
      if (slackId) {
        coQSlackIds.push(slackId);
      }
    }
  }

  const blocks: View["blocks"] = [
    // Title input
    {
      type: "input",
      block_id: ACTIONS.EVENT_PREBLAST_TITLE,
      label: { type: "plain_text", text: "Title" },
      hint: {
        type: "plain_text",
        text: "Studies show that fun titles generate 42% more HCs!",
      },
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.EVENT_PREBLAST_TITLE,
        placeholder: { type: "plain_text", text: "Event Title" },
        initial_value: initialTitle,
      },
    },
    // Location select
    {
      type: "input",
      block_id: ACTIONS.EVENT_PREBLAST_LOCATION,
      label: { type: "plain_text", text: "Location" },
      optional: true,
      element: {
        type: "static_select",
        action_id: ACTIONS.EVENT_PREBLAST_LOCATION,
        placeholder: { type: "plain_text", text: "Select location" },
        options: locationOptions.length > 0 ? locationOptions : undefined,
        ...(initialLocationId &&
        locationOptions.find((o) => o.value === initialLocationId)
          ? {
              initial_option: locationOptions.find(
                (o) => o.value === initialLocationId,
              ),
            }
          : {}),
      },
    },
    // Start time picker
    {
      type: "input",
      block_id: ACTIONS.EVENT_PREBLAST_START_TIME,
      label: { type: "plain_text", text: "Start Time" },
      element: {
        type: "timepicker",
        action_id: ACTIONS.EVENT_PREBLAST_START_TIME,
        placeholder: { type: "plain_text", text: "Select start time" },
        ...(initialTime ? { initial_time: initialTime } : {}),
      },
    },
    // Co-Qs multi-user select
    {
      type: "input",
      block_id: ACTIONS.EVENT_PREBLAST_COQS,
      label: { type: "plain_text", text: "Co-Qs" },
      optional: true,
      element: {
        type: "multi_users_select",
        action_id: ACTIONS.EVENT_PREBLAST_COQS,
        placeholder: { type: "plain_text", text: "Select Co-Qs" },
        ...(coQSlackIds.length > 0 ? { initial_users: coQSlackIds } : {}),
      },
    },
    // Event tag select
    {
      type: "input",
      block_id: ACTIONS.EVENT_PREBLAST_TAG,
      label: { type: "plain_text", text: "Event Tag" },
      optional: true,
      element: {
        type: "static_select",
        action_id: ACTIONS.EVENT_PREBLAST_TAG,
        placeholder: { type: "plain_text", text: "Select Event Tag" },
        options: tagOptions.length > 0 ? tagOptions : undefined,
        ...(initialTagId && tagOptions.find((o) => o.value === initialTagId)
          ? {
              initial_option: tagOptions.find((o) => o.value === initialTagId),
            }
          : {}),
      },
    },
    // Preblast content (rich text)
    {
      type: "input",
      block_id: ACTIONS.EVENT_PREBLAST_MOLESKINE_EDIT,
      label: { type: "plain_text", text: "Preblast" },
      element: {
        type: "rich_text_input",
        action_id: ACTIONS.EVENT_PREBLAST_MOLESKINE_EDIT,
        placeholder: {
          type: "plain_text",
          text: "Give us an event preview!",
        },
        initial_value: initialMoleskine as never,
      },
    },
  ];

  // Add send options or update mode based on preblast state
  const preblastChannel = getPreblastChannel(spaceSettings, preblastInfo);
  const existingPreblastTs = (event as { preblastTs?: number | null })
    .preblastTs;

  if (!preblastChannel) {
    // No channel configured - show warning
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":warning: A Slack channel has not been set for this AO or region, so this will not be posted. An admin can set the channel for the AO through Calendar Settings → Manage AOs or for the region through Preblast & Backblast Settings.",
      },
    });
  } else if (existingPreblastTs) {
    // Already posted - show update mode options
    blocks.push({
      type: "input",
      block_id: ACTIONS.EVENT_PREBLAST_UPDATE_MODE,
      label: {
        type: "plain_text",
        text: "How would you like to update the preblast?",
      },
      element: {
        type: "radio_buttons",
        action_id: ACTIONS.EVENT_PREBLAST_UPDATE_MODE,
        options: [
          {
            text: { type: "plain_text", text: "Update preblast" },
            value: "Update preblast",
          },
          {
            text: { type: "plain_text", text: "Repost preblast" },
            value: "Repost preblast",
          },
        ],
        initial_option: {
          text: { type: "plain_text", text: "Update preblast" },
          value: "Update preblast",
        },
      },
    });
  } else {
    // New preblast - show send options
    blocks.push({
      type: "input",
      block_id: ACTIONS.EVENT_PREBLAST_SEND_OPTIONS,
      label: {
        type: "plain_text",
        text: `When would you like to send the preblast to <#${preblastChannel}>?`,
      },
      element: {
        type: "radio_buttons",
        action_id: ACTIONS.EVENT_PREBLAST_SEND_OPTIONS,
        options: [
          {
            text: { type: "plain_text", text: "Send now" },
            value: "Send now",
          },
          {
            text: { type: "plain_text", text: "Send a day before the event" },
            value: "Send a day before the event",
          },
        ],
        initial_option: {
          text: { type: "plain_text", text: scheduleDefault },
          value: scheduleDefault,
        },
      },
    });
  }

  // Add action buttons at the bottom
  blocks.push(...buildActionButtons(preblastInfo, event.id));

  return blocks;
}

/**
 * Build the preblast edit modal.
 *
 * Shows edit form for Q users, read-only view for others.
 */
export async function buildPreblastEditModal(
  eventInstanceId: number,
  currentUserId: number | null,
  teamId: string,
  navMetadata: NavigationMetadata,
  spaceSettings: {
    preblast_moleskin_template?: string | null;
    default_preblast_destination?: string | null;
    preblast_destination_channel?: string | null;
  } | null,
  regionOrgId: number,
  actionValue?: string,
): Promise<ModalView | null> {
  const preblastInfo = await buildPreblastInfo(
    eventInstanceId,
    currentUserId,
    teamId,
  );

  if (!preblastInfo) {
    return null;
  }

  // Determine if we should show edit form or read-only view
  const showEditForm = actionValue === "Edit Preblast" || preblastInfo.userIsQ;

  let blocks: View["blocks"];
  let titleText: string;
  let submitButtonText: string | null;
  let callbackId: string;

  if (showEditForm) {
    blocks = await buildPreblastEditFormBlocks(
      preblastInfo,
      spaceSettings,
      regionOrgId,
    );
    titleText = "Edit Event Preblast";
    submitButtonText = "Update";
    callbackId = ACTIONS.EVENT_PREBLAST_CALLBACK_ID;
  } else {
    blocks = buildPreblastDisplayBlocks(preblastInfo, eventInstanceId);
    titleText = "Event Preblast";
    submitButtonText = null;
    callbackId = ACTIONS.EVENT_PREBLAST_CALLBACK_ID;
  }

  // Build metadata
  const metadata: PreblastEditMetadata = {
    ...navMetadata,
    eventInstanceId,
    preblastTs: (preblastInfo.eventRecord as { preblastTs?: number | null })
      .preblastTs
      ? String(
          (preblastInfo.eventRecord as { preblastTs?: number | null })
            .preblastTs,
        )
      : null,
  };

  const modal: ModalView = {
    type: "modal",
    callback_id: callbackId,
    title: { type: "plain_text", text: titleText },
    close: { type: "plain_text", text: "Close" },
    blocks,
    private_metadata: stringifyNavMetadata(metadata),
  };

  if (submitButtonText) {
    modal.submit = { type: "plain_text", text: submitButtonText };
  }

  return modal;
}

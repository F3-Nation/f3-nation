/**
 * Backblast Edit Form Builder
 *
 * Builds the modal for creating and editing backblasts.
 * Supports both scheduled events (with pre-filled data) and
 * unscheduled events (with date/AO/event type selection).
 */

import type { ModalView, View } from "@slack/types";

import { ACTIONS } from "../../constants/actions";
import { ATTENDANCE_TYPES, isQRole } from "../../constants/attendance-types";
import { api } from "../../lib/api-client";
import { getCurrentDateCST } from "../../lib/helpers";
import { logger } from "../../lib/logger";
import { stringifyNavMetadata } from "../../types/bolt-types";
import type { NavigationMetadata } from "../../types/bolt-types";
import type { OrgSettings, CustomField } from "../../types";
import type {
  BackblastEditMetadata,
  BackblastInfo,
} from "./edit-form-types";

/** Default backblast template when none is configured */
const DEFAULT_BACKBLAST_TEMPLATE = {
  type: "rich_text",
  elements: [
    {
      type: "rich_text_section",
      elements: [
        { text: "Enter your backblast details here...", type: "text" },
      ],
    },
  ],
};

/**
 * Build backblast info data structure.
 * Fetches event instance and attendance data, computes display values.
 */
export async function buildBackblastInfo(
  eventInstanceId: number,
  currentUserId: number | null,
  teamId: string,
  originalPoster?: string,
): Promise<BackblastInfo | null> {
  try {
    // Fetch event instance
    const eventRecord = (await api.eventInstance.byId({
      id: eventInstanceId,
    })) as BackblastInfo["eventRecord"];
    if (!eventRecord) {
      logger.error("Event instance not found", { eventInstanceId });
      return null;
    }

    // Fetch attendance records - for backblast, we want:
    // - If backblast already posted (paxCount not null): use actual attendance (isPlanned=false)
    // - If backblast not yet posted: use planned attendance (isPlanned=true)
    const isAlreadyPosted = eventRecord.paxCount !== null;
    const { attendance: attendanceRecords } =
      await api.attendance.getForEventInstance({
        eventInstanceId,
        isPlanned: !isAlreadyPosted,
      });

    // Build attendance -> Slack ID map for this team
    const attendanceSlackDict = new Map<number, string | null>();
    for (const record of attendanceRecords) {
      const slackUser = record.slackUsers.find((s) => s.slackTeamId === teamId);
      attendanceSlackDict.set(record.id, slackUser?.slackId ?? null);
    }

    // Find non-Slack attendance (users without Slack link for this team)
    const nonSlackAttendance = attendanceRecords.filter(
      (r) => !attendanceSlackDict.get(r.id),
    );

    // Find Q and Co-Qs
    const qRecord = attendanceRecords.find((r) =>
      r.attendanceTypes.some((t) => t.id === ATTENDANCE_TYPES.Q),
    );
    const coQRecords = attendanceRecords.filter((r) =>
      r.attendanceTypes.some((t) => t.id === ATTENDANCE_TYPES.COQ),
    );

    const qSlackId = qRecord ? attendanceSlackDict.get(qRecord.id) : null;
    const coQSlackIds = coQRecords
      .map((r) => attendanceSlackDict.get(r.id))
      .filter((id): id is string => id !== null);

    // Build display strings
    const qDisplay = qSlackId
      ? `<@${qSlackId}>`
      : qRecord?.user?.f3Name
        ? `@${qRecord.user.f3Name}`
        : "Open!";

    const coQParts: string[] = [];
    for (const record of coQRecords) {
      const slackId = attendanceSlackDict.get(record.id);
      if (slackId) {
        coQParts.push(`<@${slackId}>`);
      } else if (record.user?.f3Name) {
        coQParts.push(`@${record.user.f3Name}`);
      }
    }
    const coQDisplay = coQParts.length > 0 ? coQParts.join(" ") : "";

    // Build PAX list (all attendees)
    const paxParts: string[] = [];
    const paxSlackIds: string[] = [];
    for (const record of attendanceRecords) {
      const slackId = attendanceSlackDict.get(record.id);
      if (slackId) {
        paxParts.push(`<@${slackId}>`);
        paxSlackIds.push(slackId);
      } else if (record.user?.f3Name) {
        paxParts.push(`@${record.user.f3Name}`);
      }
    }
    const paxDisplay = paxParts.length > 0 ? paxParts.join(" ") : "None";

    // Check if current user is Q or Co-Q
    const userIsQ = currentUserId
      ? attendanceRecords.some(
          (r) =>
            r.userId === currentUserId &&
            r.attendanceTypes.some((t) => isQRole(t.id)),
        )
      : false;

    // Check if current user is the original poster
    const userSlackId = currentUserId
      ? attendanceRecords.find((r) => r.userId === currentUserId)?.slackUsers[0]
          ?.slackId
      : null;
    const userIsOriginalPoster = originalPoster
      ? userSlackId === originalPoster
      : false;

    return {
      eventRecord,
      attendanceRecords,
      userIsQ,
      userIsOriginalPoster,
      currentUserId,
      qDisplay,
      qSlackId: qSlackId ?? null,
      coQDisplay,
      coQSlackIds,
      paxDisplay,
      paxSlackIds,
      attendanceSlackDict,
      nonSlackAttendance,
    };
  } catch (error) {
    logger.error("Failed to build backblast info", { eventInstanceId, error });
    return null;
  }
}

/**
 * Get the destination channel for a backblast.
 * Checks region settings and AO channel configuration.
 */
export function getBackblastChannel(
  spaceSettings: OrgSettings | null,
  backblastInfo: BackblastInfo,
): string | null {
  // Check if region has a specified destination channel
  if (
    spaceSettings?.default_backblast_destination === "specified" &&
    spaceSettings.backblast_destination_channel
  ) {
    return spaceSettings.backblast_destination_channel;
  }

  // Fall back to AO's Slack channel from org meta
  const aoChannelId = backblastInfo.eventRecord.org?.meta?.slack_channel_id;
  return typeof aoChannelId === "string" ? aoChannelId : null;
}

/**
 * Build unscheduled event form blocks (date, AO, event type selects).
 * These are shown only for backblasts not linked to a calendar event.
 */
async function buildUnscheduledEventBlocks(
  regionOrgId: number,
  initialDate?: string,
  initialAoId?: number,
  initialEventTypeId?: number,
): Promise<View["blocks"]> {
  // Fetch AOs for the region
  let aoOptions: { text: { type: "plain_text"; text: string }; value: string }[] =
    [];
  try {
    const { orgs } = await api.org.all({ orgTypes: ["ao"], parentOrgIds: [regionOrgId] });
    aoOptions = orgs.map((ao) => ({
      text: { type: "plain_text" as const, text: ao.name },
      value: String(ao.id),
    }));
  } catch (error) {
    logger.warn("Failed to fetch AOs", error);
  }

  // Fetch event types for the region
  let eventTypeOptions: {
    text: { type: "plain_text"; text: string };
    value: string;
  }[] = [];
  try {
    const { eventTypes } = await api.eventType.all({ orgIds: [regionOrgId] });
    eventTypeOptions = eventTypes.map((et) => ({
      text: { type: "plain_text" as const, text: et.name },
      value: String(et.id),
    }));
  } catch (error) {
    logger.warn("Failed to fetch event types", error);
  }

  const blocks: View["blocks"] = [
    // Workout date
    {
      type: "input",
      block_id: ACTIONS.BACKBLAST_DATE,
      label: { type: "plain_text", text: "Workout Date" },
      element: {
        type: "datepicker",
        action_id: ACTIONS.BACKBLAST_DATE,
        placeholder: { type: "plain_text", text: "Select the date..." },
        initial_date: initialDate ?? getCurrentDateCST(),
      },
    },
    // Event type
    {
      type: "input",
      block_id: ACTIONS.BACKBLAST_EVENT_TYPE,
      label: { type: "plain_text", text: "Event Type" },
      element: {
        type: "static_select",
        action_id: ACTIONS.BACKBLAST_EVENT_TYPE,
        placeholder: { type: "plain_text", text: "Select the event type..." },
        options: eventTypeOptions.length > 0 ? eventTypeOptions : undefined,
        ...(initialEventTypeId &&
        eventTypeOptions.find((o) => o.value === String(initialEventTypeId))
          ? {
              initial_option: eventTypeOptions.find(
                (o) => o.value === String(initialEventTypeId),
              ),
            }
          : {}),
      },
    },
    // The AO
    {
      type: "input",
      block_id: ACTIONS.BACKBLAST_AO,
      label: { type: "plain_text", text: "The AO" },
      element: {
        type: "static_select",
        action_id: ACTIONS.BACKBLAST_AO,
        placeholder: { type: "plain_text", text: "Select the AO..." },
        options: aoOptions.length > 0 ? aoOptions : undefined,
        ...(initialAoId &&
        aoOptions.find((o) => o.value === String(initialAoId))
          ? {
              initial_option: aoOptions.find(
                (o) => o.value === String(initialAoId),
              ),
            }
          : {}),
      },
    },
  ];

  return blocks;
}

/**
 * Build custom field blocks from region settings.
 * CustomField format: { name, type, options?, enabled }
 */
function buildCustomFieldBlocks(
  customFields: CustomField[] | null | undefined,
  initialValues?: Record<string, unknown>,
): View["blocks"] {
  if (!customFields || customFields.length === 0) return [];

  const blocks: View["blocks"] = [];
  const prefix = "custom_field_";

  for (const field of customFields) {
    if (!field.enabled) continue;

    const actionId = `${prefix}${field.name.toLowerCase().replace(/\s+/g, "_")}`;
    const initialValue = initialValues?.[field.name];

    if (field.type === "text") {
      blocks.push({
        type: "input",
        block_id: actionId,
        optional: true,
        label: { type: "plain_text", text: field.name },
        element: {
          type: "plain_text_input",
          action_id: actionId,
          placeholder: { type: "plain_text", text: `Enter ${field.name}...` },
          ...(typeof initialValue === "string"
            ? { initial_value: initialValue }
            : {}),
        },
      });
    } else if ((field.type === "select" || field.type === "multi_select") && field.options) {
      const options = field.options.map((opt) => ({
        text: { type: "plain_text" as const, text: opt },
        value: opt,
      }));

      if (field.type === "select") {
        blocks.push({
          type: "input",
          block_id: actionId,
          optional: true,
          label: { type: "plain_text", text: field.name },
          element: {
            type: "static_select",
            action_id: actionId,
            placeholder: { type: "plain_text", text: `Select ${field.name}...` },
            options: options.length > 0 ? options : undefined,
            ...(typeof initialValue === "string" &&
            options.find((o) => o.value === initialValue)
              ? {
                  initial_option: options.find((o) => o.value === initialValue),
                }
              : {}),
          },
        });
      } else {
        // multi_select
        blocks.push({
          type: "input",
          block_id: actionId,
          optional: true,
          label: { type: "plain_text", text: field.name },
          element: {
            type: "multi_static_select",
            action_id: actionId,
            placeholder: { type: "plain_text", text: `Select ${field.name}...` },
            options: options.length > 0 ? options : undefined,
            ...(Array.isArray(initialValue) && initialValue.length > 0
              ? {
                  initial_options: options.filter((o) =>
                    initialValue.includes(o.value),
                  ),
                }
              : {}),
          },
        });
      }
    }
  }

  return blocks;
}

/**
 * Build the backblast edit modal view.
 *
 * @param backblastInfo - Pre-built backblast info (null for unscheduled)
 * @param navMetadata - Navigation metadata for view stack
 * @param spaceSettings - Region-specific settings
 * @param regionOrgId - Region org ID for API calls
 * @param isEdit - Whether this is an edit of an existing backblast
 * @param currentUserSlackId - Current user's Slack ID
 * @param existingMessageTs - Optional existing message timestamp (for editing posted backblasts)
 */
export async function buildBackblastEditModal(
  backblastInfo: BackblastInfo | null,
  navMetadata: NavigationMetadata,
  spaceSettings: OrgSettings | null,
  regionOrgId: number,
  isEdit: boolean,
  currentUserSlackId: string,
  existingMessageTs?: string,
): Promise<ModalView> {
  const isUnscheduled = !backblastInfo;
  const event = backblastInfo?.eventRecord;

  // Build metadata - use provided messageTs if available, otherwise fall back to event record
  const metadata: BackblastEditMetadata = {
    ...navMetadata,
    eventInstanceId: event?.id,
    backblastTs: existingMessageTs ?? event?.backblastTs?.toString() ?? null,
    isUnscheduled,
    originalPoster: currentUserSlackId,
  };

  const blocks: View["blocks"] = [];

  // Title input
  blocks.push({
    type: "input",
    block_id: ACTIONS.BACKBLAST_TITLE,
    label: { type: "plain_text", text: "Title" },
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.BACKBLAST_TITLE,
      placeholder: { type: "plain_text", text: "Enter a workout title..." },
      initial_value: event?.name ?? "",
    },
  });

  // File upload for boyband
  blocks.push({
    type: "input",
    block_id: ACTIONS.BACKBLAST_FILE,
    optional: true,
    label: { type: "plain_text", text: "Upload a boyband" },
    element: {
      type: "file_input",
      action_id: ACTIONS.BACKBLAST_FILE,
      max_files: 1,
      filetypes: ["png", "jpg", "jpeg", "heic", "bmp", "gif"],
    },
  });

  // For scheduled events, show info block; for unscheduled, show date/AO/type selects
  if (isUnscheduled) {
    const unscheduledBlocks = await buildUnscheduledEventBlocks(regionOrgId);
    blocks.push(...unscheduledBlocks);
  } else if (event) {
    // Info block showing AO, Date, Event Type
    const eventTypesStr =
      event.eventTypes?.map((t) => t.eventTypeName).join(" / ") ?? "Workout";
    const infoText = `*AO:* ${event.org?.name ?? "Unknown"}\n*DATE:* ${event.startDate}\n*EVENT TYPE:* ${eventTypesStr}`;
    blocks.push({
      type: "section",
      block_id: ACTIONS.BACKBLAST_INFO,
      text: { type: "mrkdwn", text: infoText },
    });
  }

  // Q selector
  blocks.push({
    type: "input",
    block_id: ACTIONS.BACKBLAST_Q,
    label: { type: "plain_text", text: "The Q" },
    element: {
      type: "users_select",
      action_id: ACTIONS.BACKBLAST_Q,
      placeholder: { type: "plain_text", text: "Select the Q..." },
      ...(backblastInfo?.qSlackId
        ? { initial_user: backblastInfo.qSlackId }
        : { initial_user: currentUserSlackId }),
    },
  });

  // Co-Q selector
  blocks.push({
    type: "input",
    block_id: ACTIONS.BACKBLAST_COQ,
    optional: true,
    label: { type: "plain_text", text: "The CoQ(s), if any" },
    element: {
      type: "multi_users_select",
      action_id: ACTIONS.BACKBLAST_COQ,
      placeholder: { type: "plain_text", text: "Select the CoQ(s)..." },
      ...(backblastInfo?.coQSlackIds && backblastInfo.coQSlackIds.length > 0
        ? { initial_users: backblastInfo.coQSlackIds }
        : {}),
    },
  });

  // PAX selector
  blocks.push({
    type: "input",
    block_id: ACTIONS.BACKBLAST_PAX,
    label: { type: "plain_text", text: "The PAX" },
    element: {
      type: "multi_users_select",
      action_id: ACTIONS.BACKBLAST_PAX,
      placeholder: { type: "plain_text", text: "Select the PAX..." },
      ...(backblastInfo?.paxSlackIds && backblastInfo.paxSlackIds.length > 0
        ? { initial_users: backblastInfo.paxSlackIds }
        : {}),
    },
  });

  // Downrange PAX (external select) - Note: This requires external_select with options_load_url
  // For now, we'll show a placeholder; full implementation needs the options handler
  // blocks.push({
  //   type: "input",
  //   block_id: ACTIONS.BACKBLAST_DR_PAX,
  //   optional: true,
  //   label: { type: "plain_text", text: "Downrange PAX" },
  //   element: {
  //     type: "multi_external_select",
  //     action_id: ACTIONS.BACKBLAST_DR_PAX,
  //     placeholder: { type: "plain_text", text: "Type to search..." },
  //     min_query_length: 2,
  //   },
  // });

  // Non-Slack PAX text input
  blocks.push({
    type: "input",
    block_id: ACTIONS.BACKBLAST_NONSLACK_PAX,
    optional: true,
    label: {
      type: "plain_text",
      text: "List untaggable PAX, separated by commas (not FNGs)",
    },
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.BACKBLAST_NONSLACK_PAX,
      placeholder: { type: "plain_text", text: "Enter untaggable PAX..." },
    },
  });

  // FNGs text input
  blocks.push({
    type: "input",
    block_id: ACTIONS.BACKBLAST_FNGS,
    optional: true,
    label: { type: "plain_text", text: "List FNGs, separated by commas" },
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.BACKBLAST_FNGS,
      placeholder: { type: "plain_text", text: "Enter FNGs..." },
    },
  });

  // Total PAX count
  blocks.push({
    type: "input",
    block_id: ACTIONS.BACKBLAST_COUNT,
    optional: true,
    label: { type: "plain_text", text: "Total PAX Count" },
    hint: {
      type: "plain_text",
      text: "If left blank, this will be calculated automatically from the fields above.",
    },
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.BACKBLAST_COUNT,
      placeholder: { type: "plain_text", text: "Total PAX count including FNGs" },
    },
  });

  // Moleskine rich text input
  // Get initial moleskine: saved_moleskin from meta > backblast_rich > template
  let initialMoleskine: Record<string, unknown> | null = null;
  if (event?.meta && typeof event.meta === "object") {
    const savedMoleskin = event.meta.saved_moleskin;
    if (savedMoleskin && typeof savedMoleskin === "object") {
      initialMoleskine = savedMoleskin as Record<string, unknown>;
    }
  }
  if (!initialMoleskine && event?.backblastRich && event.backblastRich.length > 0) {
    // Find the rich_text block in the backblast_rich array
    const richTextBlock = event.backblastRich.find(
      (b) => b.type === "rich_text",
    );
    if (richTextBlock) {
      initialMoleskine = richTextBlock;
    }
  }
  if (!initialMoleskine && spaceSettings?.backblast_moleskin_template) {
    try {
      initialMoleskine = JSON.parse(
        spaceSettings.backblast_moleskin_template,
      ) as Record<string, unknown>;
    } catch {
      // Not valid JSON, ignore
    }
  }
  if (!initialMoleskine) {
    initialMoleskine = DEFAULT_BACKBLAST_TEMPLATE;
  }

  blocks.push({
    type: "input",
    block_id: ACTIONS.BACKBLAST_MOLESKINE,
    label: { type: "plain_text", text: "The Moleskine" },
    element: {
      type: "rich_text_input",
      action_id: ACTIONS.BACKBLAST_MOLESKINE,
      initial_value: initialMoleskine,
    } as View["blocks"][number] extends { element: infer E } ? E : never,
  });

  // Context note about privacy
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "*Note:* anything you put here may be visible to the public, through dashboards, websites, etc. We encourage you to post private COT items (prayer requests, etc) in a separate post or reply to the backblast.",
      },
    ],
  });

  // Custom fields from region settings
  const customFieldBlocks = buildCustomFieldBlocks(
    spaceSettings?.custom_fields,
    event?.meta as Record<string, unknown> | undefined,
  );
  blocks.push(...customFieldBlocks);

  // Options checkbox
  const optionsValue = event?.meta?.exclude_from_pax_vault
    ? ["exclude_from_pax_vault"]
    : undefined;
  blocks.push({
    type: "input",
    block_id: ACTIONS.BACKBLAST_OPTIONS,
    optional: true,
    label: { type: "plain_text", text: "Backblast Options" },
    element: {
      type: "checkboxes",
      action_id: ACTIONS.BACKBLAST_OPTIONS,
      options: [
        {
          text: { type: "plain_text", text: "Exclude stats from PAX Vault" },
          value: "exclude_from_pax_vault",
        },
      ],
      ...(optionsValue ? { initial_options: [{ text: { type: "plain_text", text: "Exclude stats from PAX Vault" }, value: "exclude_from_pax_vault" }] } : {}),
    },
  });

  blocks.push({ type: "divider" });

  // Email option (only if email is enabled and option_show is set)
  const showEmailOption =
    spaceSettings?.email_enable === true &&
    spaceSettings?.email_option_show === true;
  if (showEmailOption) {
    blocks.push({
      type: "input",
      block_id: ACTIONS.BACKBLAST_EMAIL_SEND,
      label: { type: "plain_text", text: "Email Backblast (to Wordpress, etc)" },
      element: {
        type: "radio_buttons",
        action_id: ACTIONS.BACKBLAST_EMAIL_SEND,
        options: [
          { text: { type: "plain_text", text: "Send Email" }, value: "yes" },
          {
            text: { type: "plain_text", text: "Don't Send Email" },
            value: "no",
          },
        ],
        initial_option: {
          text: { type: "plain_text", text: "Send Email" },
          value: "yes",
        },
      },
    });
  }

  // Send timing option (only for create, not edit)
  // Also, if event is in the future, default to "Save and send later"
  if (!isEdit) {
    const today = getCurrentDateCST();
    const eventDate = event?.startDate ?? today;
    const isFutureEvent = eventDate > today;

    blocks.push({
      type: "input",
      block_id: ACTIONS.BACKBLAST_SEND_OPTIONS,
      label: { type: "plain_text", text: "When to post backblast?" },
      element: {
        type: "radio_buttons",
        action_id: ACTIONS.BACKBLAST_SEND_OPTIONS,
        options: [
          { text: { type: "plain_text", text: "Send now" }, value: "Send now" },
          {
            text: { type: "plain_text", text: "Save and send later" },
            value: "Save and send later",
          },
        ],
        initial_option: isFutureEvent
          ? {
              text: { type: "plain_text", text: "Save and send later" },
              value: "Save and send later",
            }
          : { text: { type: "plain_text", text: "Send now" }, value: "Send now" },
      },
    });
  }

  return {
    type: "modal",
    callback_id: isEdit
      ? ACTIONS.BACKBLAST_EDIT_CALLBACK_ID
      : ACTIONS.BACKBLAST_CALLBACK_ID,
    private_metadata: stringifyNavMetadata(metadata),
    title: {
      type: "plain_text",
      text: isEdit ? "Edit Backblast" : "New Backblast",
      emoji: true,
    },
    submit: {
      type: "plain_text",
      text: isEdit ? "Update" : "Submit",
      emoji: true,
    },
    close: {
      type: "plain_text",
      text: "Cancel",
      emoji: true,
    },
    blocks,
  };
}

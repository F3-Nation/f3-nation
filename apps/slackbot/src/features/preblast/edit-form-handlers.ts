/**
 * Preblast Edit Form Handlers
 *
 * Handles form submission and action buttons for preblast editing.
 */

import type { ModalView } from "@slack/types";
import type { WebClient } from "@slack/web-api";

import { ACTIONS } from "../../constants/actions";
import { ATTENDANCE_TYPES } from "../../constants/attendance-types";
import { api } from "../../lib/api-client";
import {
  parseRichBlock,
  replaceUserChannelIds,
  normalizeTimeForStorage,
  safeGet,
} from "../../lib/helpers";
import { logger } from "../../lib/logger";
import { createNavContext, navigateToView } from "../../lib/view-navigation";
import type {
  ExtendedContext,
  NavigationMetadata,
  TypedViewArgs,
  TypedActionArgs,
} from "../../types/bolt-types";
import { parseNavMetadata } from "../../types/bolt-types";
import type {
  PreblastEditMetadata,
  PreblastFormValues,
  SendPreblastResult,
} from "./edit-form-types";
import {
  buildPreblastInfo,
  buildPreblastEditModal,
  getPreblastChannel,
} from "./edit-form";

/**
 * Extract form values from the view submission body.
 */
function extractFormValues(body: TypedViewArgs["body"]): PreblastFormValues {
  const values = body.view.state.values;

  return {
    title:
      safeGet<string>(
        values,
        ACTIONS.EVENT_PREBLAST_TITLE,
        ACTIONS.EVENT_PREBLAST_TITLE,
        "value",
      ) ?? "",
    locationId: safeGet<string>(
      values,
      ACTIONS.EVENT_PREBLAST_LOCATION,
      ACTIONS.EVENT_PREBLAST_LOCATION,
      "selected_option",
      "value",
    ),
    startTime:
      safeGet<string>(
        values,
        ACTIONS.EVENT_PREBLAST_START_TIME,
        ACTIONS.EVENT_PREBLAST_START_TIME,
        "selected_time",
      ) ?? "",
    coQs: safeGet<string[]>(
      values,
      ACTIONS.EVENT_PREBLAST_COQS,
      ACTIONS.EVENT_PREBLAST_COQS,
      "selected_users",
    ),
    tagId: safeGet<string>(
      values,
      ACTIONS.EVENT_PREBLAST_TAG,
      ACTIONS.EVENT_PREBLAST_TAG,
      "selected_option",
      "value",
    ),
    moleskine:
      safeGet<Record<string, unknown>>(
        values,
        ACTIONS.EVENT_PREBLAST_MOLESKINE_EDIT,
        ACTIONS.EVENT_PREBLAST_MOLESKINE_EDIT,
        "rich_text_value",
      ) ?? {},
    sendOption: (safeGet<string>(
      values,
      ACTIONS.EVENT_PREBLAST_SEND_OPTIONS,
      ACTIONS.EVENT_PREBLAST_SEND_OPTIONS,
      "selected_option",
      "value",
    ) ?? "Send now") as PreblastFormValues["sendOption"],
    updateMode: safeGet<string>(
      values,
      ACTIONS.EVENT_PREBLAST_UPDATE_MODE,
      ACTIONS.EVENT_PREBLAST_UPDATE_MODE,
      "selected_option",
      "value",
    ) as PreblastFormValues["updateMode"],
  };
}

/**
 * Send or update a preblast message in Slack.
 */
async function sendPreblast(
  client: WebClient,
  eventInstanceId: number,
  teamId: string,
  slackUserId: string,
  spaceSettings: {
    default_preblast_destination?: string | null;
    preblast_destination_channel?: string | null;
  } | null,
  repost = false,
): Promise<SendPreblastResult> {
  const preblastInfo = await buildPreblastInfo(eventInstanceId, null, teamId);

  if (!preblastInfo) {
    return { success: false, error: "Failed to load preblast info" };
  }

  const preblastChannel = getPreblastChannel(spaceSettings, preblastInfo);
  const event = preblastInfo.eventRecord;
  const existingTs = (event as { preblastTs?: number | null }).preblastTs;

  // Get Q user info for the post author
  const qRecords = preblastInfo.attendanceRecords.filter((r) =>
    r.attendanceTypes.some(
      (t) => t.id === ATTENDANCE_TYPES.Q || t.id === ATTENDANCE_TYPES.COQ,
    ),
  );
  const qSlackId =
    qRecords.length > 0
      ? preblastInfo.attendanceSlackDict.get(qRecords[0]!.id)
      : null;
  const authorSlackId = qSlackId ?? slackUserId;

  // Get author display info
  let username: string | undefined;
  let iconUrl: string | undefined;
  try {
    const userInfo = await client.users.info({ user: authorSlackId });
    // Using || here intentionally since empty strings should fallback
    const displayName =
      userInfo.user?.profile?.display_name ??
      userInfo.user?.profile?.real_name ??
      userInfo.user?.name ??
      "F3 PAX";
    username = `${displayName} (via F3 Nation)`;
    iconUrl = userInfo.user?.profile?.image_72 ?? undefined;
  } catch (error) {
    logger.warn("Failed to get user info for preblast author", error);
  }

  // Build preblast blocks for the channel message
  const blocks = buildChannelPreblastBlocks(preblastInfo, eventInstanceId);

  // Build metadata for the message (convert arrays to comma-separated strings for Slack API compatibility)
  const metadata = {
    event_type: "preblast" as const,
    event_payload: {
      event_instance_id: eventInstanceId,
      attendees: preblastInfo.attendanceRecords.map((r) => r.userId).join(","),
      qs: qRecords.map((r) => r.userId).join(","),
    },
  };

  if (!preblastChannel) {
    // No channel - send DM to user explaining the situation
    try {
      await client.chat.postMessage({
        channel: slackUserId,
        text:
          "Your preblast was saved. However, in order to post it to Slack, you will need to set a preblast channel. " +
          "This can be done by region admins; either at the AO level by going to Settings → Calendar Settings → Manage AOs, " +
          "or at the region level by going to Settings → Preblast and Backblast Settings.",
      });
    } catch (error) {
      logger.error("Failed to send preblast info DM", error);
    }
    return { success: true, error: "No channel configured" };
  }

  try {
    if (existingTs && !repost) {
      // Update existing message
      await client.chat.update({
        channel: preblastChannel,
        ts: String(existingTs),
        blocks,
        text: "Event Preblast",
        metadata,
      });
      return {
        success: true,
        messageTs: String(existingTs),
        channel: preblastChannel,
      };
    } else if (existingTs && repost) {
      // Delete old message and post new
      try {
        await client.chat.delete({
          channel: preblastChannel,
          ts: String(existingTs),
        });
      } catch (error) {
        logger.warn("Failed to delete old preblast message", error);
      }
    }

    // Post new message
    const result = await client.chat.postMessage({
      channel: preblastChannel,
      blocks,
      text: "Event Preblast",
      metadata,
      unfurl_links: false,
      username,
      icon_url: iconUrl,
    });

    // Update event instance with new timestamp
    if (result.ts) {
      await api.eventInstance.crupdate({
        id: eventInstanceId,
        orgId: event.orgId,
        startDate: event.startDate,
        meta: {
          ...(event.meta! ?? {}),
          preblast_ts: parseFloat(result.ts),
        },
      });
    }

    return { success: true, messageTs: result.ts, channel: preblastChannel };
  } catch (error) {
    logger.error("Failed to send preblast message", { eventInstanceId, error });
    return { success: false, error: String(error) };
  }
}

/**
 * Build blocks for the channel preblast message.
 */
function buildChannelPreblastBlocks(
  preblastInfo: ReturnType<typeof buildPreblastInfo> extends Promise<infer T>
    ? NonNullable<T>
    : never,
  eventInstanceId: number,
): ModalView["blocks"] {
  const event = preblastInfo.eventRecord;

  // Build location string
  let locationStr = "";
  const aoChannelId = event.org?.meta?.slack_channel_id;
  if (aoChannelId) {
    locationStr += `<#${aoChannelId}>`;
  }
  if (event.location) {
    const locName = event.location.locationName ?? "Location";
    if (event.location.latitude && event.location.longitude) {
      locationStr += ` - <https://www.google.com/maps/search/?api=1&query=${event.location.latitude},${event.location.longitude}|${locName}>`;
    } else {
      locationStr += ` - ${locName}`;
    }
  }

  // Format date and time
  const date = new Date(event.startDate + "T00:00:00");
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timeStr = event.startTime ?? "";

  // Build event types string
  const eventTypesStr =
    event.eventTypes?.map((t) => t.eventTypeName).join(" / ") ?? "Workout";

  // Build event tags string
  const eventTagsStr =
    event.eventTags?.map((t) => t.eventTagName).join(", ") ?? "";

  // Build event details markdown
  let eventDetails = `*Preblast: ${event.name}*`;
  eventDetails += `\n*Date:* ${dateStr}`;
  eventDetails += `\n*Time:* ${timeStr}`;
  eventDetails += `\n*Where:* ${locationStr || "TBD"}`;
  eventDetails += `\n*Event Type:* ${eventTypesStr}`;
  if (eventTagsStr) {
    eventDetails += `\n*Event Tag:* ${eventTagsStr}`;
  }
  eventDetails += `\n*Q:* ${preblastInfo.qListDisplay}`;
  eventDetails += `\n*HC Count:* ${preblastInfo.hcCount}`;
  eventDetails += `\n*HCs:* ${preblastInfo.hcListDisplay}`;

  const blocks: ModalView["blocks"] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: eventDetails,
      },
    },
  ];

  // Add preblast content
  const preblastRich = (event as { preblastRich?: Record<string, unknown> })
    .preblastRich;
  if (preblastRich) {
    blocks.push({
      type: "rich_text",
      elements: (preblastRich as { elements?: unknown[] }).elements ?? [],
    } as ModalView["blocks"][number]);
  }

  // Add action buttons
  const hasQ = preblastInfo.qListDisplay !== "Open!";
  blocks.push({
    type: "actions",
    elements: [
      ...(hasQ
        ? []
        : [
            {
              type: "button" as const,
              text: {
                type: "plain_text" as const,
                text: "Take Q",
                emoji: true,
              },
              action_id: ACTIONS.EVENT_PREBLAST_TAKE_Q,
              value: String(eventInstanceId),
            },
          ]),
      {
        type: "button" as const,
        text: { type: "plain_text" as const, text: "HC", emoji: true },
        action_id: ACTIONS.EVENT_PREBLAST_HC,
        value: String(eventInstanceId),
        style: "primary" as const,
      },
      {
        type: "button" as const,
        text: {
          type: "plain_text" as const,
          text: ":memo: New Preblast",
          emoji: true,
        },
        action_id: ACTIONS.NEW_PREBLAST_BUTTON,
      },
      {
        type: "button" as const,
        text: {
          type: "plain_text" as const,
          text: ":clipboard: Fill Backblast",
          emoji: true,
        },
        action_id: ACTIONS.MSG_EVENT_BACKBLAST_BUTTON,
        value: String(eventInstanceId),
      },
    ],
  });

  return blocks;
}

/**
 * Handle preblast form submission.
 */
export async function handlePreblastFormSubmit(
  args: TypedViewArgs,
): Promise<void> {
  const { ack, body, client, context } = args;

  // Parse metadata
  const metadata = parseNavMetadata(
    body.view.private_metadata,
  ) as PreblastEditMetadata;
  const eventInstanceId = metadata.eventInstanceId;
  const callbackId = body.view.callback_id;

  if (!eventInstanceId) {
    logger.error("No event instance ID in preblast form submission");
    await ack({ response_action: "errors", errors: {} });
    return;
  }

  // Extract form values
  const formValues = extractFormValues(body);

  // Determine if we should send the preblast
  const existingPreblastTs =
    metadata.preblastTs && metadata.preblastTs !== "null";
  const shouldSend =
    formValues.sendOption === "Send now" ||
    callbackId === ACTIONS.EVENT_PREBLAST_POST_CALLBACK_ID ||
    existingPreblastTs;

  // Parse rich text to plain text for storage
  const preblastPlainText = await replaceUserChannelIds(
    parseRichBlock(formValues.moleskine),
    client,
  );

  // Update event instance
  try {
    // Get current event to preserve orgId and startDate
    const currentEvent = await api.eventInstance.byId({ id: eventInstanceId });
    if (!currentEvent) {
      throw new Error("Event instance not found");
    }

    await api.eventInstance.crupdate({
      id: eventInstanceId,
      name: formValues.title,
      locationId: formValues.locationId
        ? parseInt(formValues.locationId, 10)
        : null,
      startTime: normalizeTimeForStorage(formValues.startTime),
      orgId: currentEvent.orgId,
      startDate: currentEvent.startDate,
      meta: {
        ...(currentEvent.meta! ?? {}),
        preblast_rich: formValues.moleskine,
        preblast: preblastPlainText,
      },
    });

    // Update event tag
    if (formValues.tagId) {
      await api.eventInstance.crupdate({
        id: eventInstanceId,
        orgId: currentEvent.orgId,
        startDate: currentEvent.startDate,
        eventTagId: parseInt(formValues.tagId, 10),
      });
    }

    // Handle Co-Qs
    if (formValues.coQs && formValues.coQs.length > 0) {
      const extContext = context as ExtendedContext;
      const teamId = extContext.teamId ?? "";

      for (const slackId of formValues.coQs) {
        try {
          // Get or create user for this Slack ID
          const slackUser = await api.slack.getUserBySlackId(slackId, teamId);
          if (slackUser?.user?.id) {
            await api.attendance.createPlanned({
              eventInstanceId,
              userId: slackUser.user.id,
              attendanceTypeIds: [ATTENDANCE_TYPES.COQ, ATTENDANCE_TYPES.PAX],
            });
          }
        } catch (error) {
          logger.warn(`Failed to add Co-Q ${slackId}`, error);
        }
      }
    }
  } catch (error) {
    logger.error("Failed to update event instance", { eventInstanceId, error });
    await ack({
      response_action: "errors",
      errors: {
        [ACTIONS.EVENT_PREBLAST_TITLE]:
          "Failed to save preblast. Please try again.",
      },
    });
    return;
  }

  // Send preblast if needed
  if (shouldSend) {
    const extContext = context as ExtendedContext;
    const teamId = extContext.teamId ?? "";
    const slackUserId = body.user.id;
    const orgSettings = extContext.orgSettings ?? null;
    const repost = formValues.updateMode === "Repost preblast";

    const result = await sendPreblast(
      client,
      eventInstanceId,
      teamId,
      slackUserId,
      orgSettings,
      repost,
    );

    if (!result.success && result.error !== "No channel configured") {
      logger.error("Failed to send preblast", {
        eventInstanceId,
        error: result.error,
      });
    }
  }

  // Close the modal
  await ack({ response_action: "clear" });
}

/**
 * Handle preblast action buttons (Take Q, Remove Q, HC, Un-HC, Edit).
 */
export async function handlePreblastAction(
  args: TypedActionArgs,
): Promise<void> {
  const { ack, body, context, action } = args;
  await ack();

  const actionWithValue = action as {
    action_id: string;
    value?: string;
  };
  const actionId = actionWithValue.action_id;
  const actionValue = actionWithValue.value;

  // Get event instance ID from action value or metadata
  const bodyWithView = body as { view?: { private_metadata?: string } };
  const metadata = parseNavMetadata(
    bodyWithView.view?.private_metadata,
  ) as PreblastEditMetadata;
  const eventInstanceId = actionValue
    ? parseInt(actionValue, 10)
    : metadata.eventInstanceId;

  if (!eventInstanceId) {
    logger.error("No event instance ID for preblast action");
    return;
  }

  const extContext = context as ExtendedContext;
  const currentUserId = extContext.slackUser?.userId;
  const teamId = extContext.teamId ?? "";

  if (!currentUserId) {
    logger.error("No current user ID for preblast action");
    return;
  }

  try {
    switch (actionId) {
      case ACTIONS.EVENT_PREBLAST_TAKE_Q:
        await api.attendance.takeQ({
          eventInstanceId,
          userId: currentUserId,
        });
        break;

      case ACTIONS.EVENT_PREBLAST_REMOVE_Q:
        await api.attendance.removeQ({
          eventInstanceId,
          userId: currentUserId,
        });
        break;

      case ACTIONS.EVENT_PREBLAST_HC:
        await api.attendance.createPlanned({
          eventInstanceId,
          userId: currentUserId,
          attendanceTypeIds: [ATTENDANCE_TYPES.PAX],
        });
        break;

      case ACTIONS.EVENT_PREBLAST_UN_HC:
        await api.attendance.removePlanned({
          eventInstanceId,
          userId: currentUserId,
        });
        break;

      case ACTIONS.EVENT_PREBLAST_EDIT:
        // Will be handled by modal refresh below
        break;

      default:
        logger.warn("Unknown preblast action", { actionId });
        return;
    }
  } catch (error) {
    logger.error("Failed to handle preblast action", {
      actionId,
      eventInstanceId,
      error,
    });
    return;
  }

  // Refresh the modal if we're in a view context
  if (bodyWithView.view?.private_metadata) {
    const navCtx = createNavContext(args);

    await navigateToView(
      navCtx,
      async (navMetadata: NavigationMetadata): Promise<ModalView> => {
        const modal = await buildPreblastEditModal(
          eventInstanceId,
          currentUserId,
          teamId,
          navMetadata,
          extContext.orgSettings ?? null,
          extContext.orgId ?? 0,
          actionId === ACTIONS.EVENT_PREBLAST_EDIT
            ? "Edit Preblast"
            : undefined,
        );
        return (
          modal ?? {
            type: "modal",
            title: { type: "plain_text", text: "Error" },
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "Failed to load preblast form." },
              },
            ],
          }
        );
      },
      { showLoading: true, loadingTitle: "Loading...", forceUpdate: true },
    );
  }
}

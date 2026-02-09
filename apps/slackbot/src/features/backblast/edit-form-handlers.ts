/**
 * Backblast Edit Form Handlers
 *
 * Handles form submission and action buttons for backblast creating and editing.
 */

import type { ModalView } from "@slack/types";
import type { WebClient } from "@slack/web-api";

import { ACTIONS } from "../../constants/actions";
import { ATTENDANCE_TYPES } from "../../constants/attendance-types";
import { api } from "../../lib/api-client";
import { env } from "../../lib/env";
import {
  extractFilesFromValues,
  uploadSlackFiles,
} from "../../lib/file-upload";
import {
  parseRichBlock,
  replaceUserChannelIds,
  safeGet,
} from "../../lib/helpers";
import { logger } from "../../lib/logger";
import type { OrgSettings } from "../../types";
import type {
  ExtendedContext,
  TypedViewArgs,
  TypedActionArgs,
} from "../../types/bolt-types";
import { parseNavMetadata } from "../../types/bolt-types";
import type {
  BackblastEditMetadata,
  BackblastFormValues,
  SendBackblastResult,
  BackblastMessageMetadata,
} from "./edit-form-types";
import {
  buildBackblastInfo,
  buildBackblastEditModal,
  getBackblastChannel,
} from "./edit-form";
import { buildBackblastMessage } from "./message-builder";

/**
 * Extract form values from the view submission body.
 */
function extractFormValues(body: TypedViewArgs["body"]): BackblastFormValues {
  const values = body.view.state.values;

  // Extract PAX count, parsing as number or null
  const countStr = safeGet<string>(
    values,
    String(ACTIONS.BACKBLAST_COUNT),
    String(ACTIONS.BACKBLAST_COUNT),
    "value",
  );
  const count = countStr ? parseInt(countStr, 10) : null;

  // Extract files from file input
  const fileObjects =
    safeGet<{ id: string; url_private: string }[]>(
      values,
      String(ACTIONS.BACKBLAST_FILE),
      String(ACTIONS.BACKBLAST_FILE),
      "files",
    ) ?? [];
  const slackFileIds = fileObjects.map((f) => f.id);
  // Note: actual file URLs will need to be processed after upload to storage

  // Extract checkbox options
  const selectedOptions =
    safeGet<{ value: string }[]>(
      values,
      String(ACTIONS.BACKBLAST_OPTIONS),
      String(ACTIONS.BACKBLAST_OPTIONS),
      "selected_options",
    ) ?? [];
  const options = selectedOptions.map((o) => o.value);

  return {
    title:
      safeGet<string>(
        values,
        String(ACTIONS.BACKBLAST_TITLE),
        String(ACTIONS.BACKBLAST_TITLE),
        "value",
      ) ?? "",
    q:
      safeGet<string>(
        values,
        String(ACTIONS.BACKBLAST_Q),
        String(ACTIONS.BACKBLAST_Q),
        "selected_user",
      ) ?? "",
    coQs:
      safeGet<string[]>(
        values,
        String(ACTIONS.BACKBLAST_COQ),
        String(ACTIONS.BACKBLAST_COQ),
        "selected_users",
      ) ?? [],
    pax:
      safeGet<string[]>(
        values,
        String(ACTIONS.BACKBLAST_PAX),
        String(ACTIONS.BACKBLAST_PAX),
        "selected_users",
      ) ?? [],
    downrangePax: [], // TODO: Implement when external select is added
    nonSlackPax:
      safeGet<string>(
        values,
        String(ACTIONS.BACKBLAST_NONSLACK_PAX),
        String(ACTIONS.BACKBLAST_NONSLACK_PAX),
        "value",
      ) ?? "",
    fngs:
      safeGet<string>(
        values,
        String(ACTIONS.BACKBLAST_FNGS),
        String(ACTIONS.BACKBLAST_FNGS),
        "value",
      ) ?? "",
    count: isNaN(count ?? NaN) ? null : count,
    moleskine:
      safeGet<Record<string, unknown>>(
        values,
        String(ACTIONS.BACKBLAST_MOLESKINE),
        String(ACTIONS.BACKBLAST_MOLESKINE),
        "rich_text_value",
      ) ?? {},
    options,
    emailSend:
      (safeGet<string>(
        values,
        String(ACTIONS.BACKBLAST_EMAIL_SEND),
        String(ACTIONS.BACKBLAST_EMAIL_SEND),
        "selected_option",
        "value",
      ) as "yes" | "no") ?? "no",
    sendOption:
      (safeGet<string>(
        values,
        String(ACTIONS.BACKBLAST_SEND_OPTIONS),
        String(ACTIONS.BACKBLAST_SEND_OPTIONS),
        "selected_option",
        "value",
      ) as BackblastFormValues["sendOption"]) ?? "Send now",
    files: [], // Will be populated after storage upload
    slackFileIds,
    // Unscheduled event fields
    date:
      safeGet<string>(
        values,
        String(ACTIONS.BACKBLAST_DATE),
        String(ACTIONS.BACKBLAST_DATE),
        "selected_date",
      ) ?? undefined,
    aoId: (() => {
      const aoStr = safeGet<string>(
        values,
        String(ACTIONS.BACKBLAST_AO),
        String(ACTIONS.BACKBLAST_AO),
        "selected_option",
        "value",
      );
      return aoStr ? parseInt(aoStr, 10) : undefined;
    })(),
    eventTypeId: (() => {
      const etStr = safeGet<string>(
        values,
        String(ACTIONS.BACKBLAST_EVENT_TYPE),
        String(ACTIONS.BACKBLAST_EVENT_TYPE),
        "selected_option",
        "value",
      );
      return etStr ? parseInt(etStr, 10) : undefined;
    })(),
  };
}

/**
 * Extract custom field values from the form submission.
 */
function extractCustomFields(
  values: Record<string, Record<string, unknown>>,
): Record<string, string> {
  const customFields: Record<string, string> = {};
  const prefix = "custom_field_";

  for (const [blockId, blockValue] of Object.entries(values)) {
    if (blockId.startsWith(prefix)) {
      const fieldName = blockId.slice(prefix.length);
      const actionValue = blockValue[blockId] as
        | { value?: string; selected_option?: { value: string } }
        | undefined;

      if (actionValue?.value) {
        customFields[fieldName] = actionValue.value;
      } else if (actionValue?.selected_option?.value) {
        customFields[fieldName] = actionValue.selected_option.value;
      }
    }
  }

  return customFields;
}

/**
 * Calculate total PAX count from form values.
 */
function calculatePaxCount(formValues: BackblastFormValues): number {
  // Count unique Slack users (Q, CoQs, PAX are combined)
  const allSlackUsers = new Set([
    formValues.q,
    ...formValues.coQs,
    ...formValues.pax,
  ]);
  let count = allSlackUsers.size;

  // Add downrange PAX count
  count += formValues.downrangePax.length;

  // Add non-Slack PAX count (comma-separated)
  if (formValues.nonSlackPax.trim()) {
    const nonSlackCount = formValues.nonSlackPax
      .split(",")
      .filter((s) => s.trim()).length;
    count += nonSlackCount;
  }

  // Add FNG count (comma-separated)
  if (formValues.fngs.trim()) {
    const fngCount = formValues.fngs.split(",").filter((s) => s.trim()).length;
    count += fngCount;
  }

  return count;
}

/**
 * Get or create F3 user IDs for Slack users.
 * Returns a map of Slack ID -> F3 user ID.
 */
async function getOrCreateUserIds(
  slackIds: string[],
  teamId: string,
  client: WebClient,
): Promise<Map<string, number>> {
  const userMap = new Map<string, number>();

  for (const slackId of slackIds) {
    try {
      // First try to get existing user
      const existingUser = await api.slack.getUserBySlackId(slackId, teamId);
      if (existingUser?.user?.id) {
        userMap.set(slackId, existingUser.user.id);
        continue;
      }

      // If not found, get Slack user info and create
      const slackUserInfo = await client.users.info({ user: slackId });
      if (!slackUserInfo.user) {
        logger.warn(`Could not find Slack user info for ${slackId}`);
        continue;
      }

      // Note: We include bot users since some regions use bots to track attendance
      // or have special-purpose accounts that should be counted as PAX
      if (slackUserInfo.user.is_bot) {
        logger.debug(`Including bot user ${slackId} in attendance`);
      }

      const userName =
        slackUserInfo.user.profile?.display_name ??
        slackUserInfo.user.profile?.real_name ??
        slackUserInfo.user.name ??
        slackId; // Fall back to Slack ID if no name available

      // For bot users or users without email, generate a placeholder email
      // The API requires a valid email format
      const email =
        slackUserInfo.user.profile?.email ??
        `${slackId}@slack.placeholder.f3nation.com`;

      // Create linked user
      const newUser = await api.slack.getOrCreateLinkedUser({
        slackId,
        teamId,
        userName,
        email,
        avatarUrl: slackUserInfo.user.profile?.image_72 ?? undefined,
        isAdmin: slackUserInfo.user.is_admin ?? false,
        isOwner: slackUserInfo.user.is_owner ?? false,
        isBot: slackUserInfo.user.is_bot ?? false,
      });

      if (newUser?.userId) {
        userMap.set(slackId, newUser.userId);
      }
    } catch (error) {
      logger.error(`Failed to get/create user for Slack ID ${slackId}`, {
        error,
      });
    }
  }

  return userMap;
}

/**
 * Send or update a backblast message in Slack.
 */
async function sendBackblast(
  client: WebClient,
  eventInstanceId: number,
  teamId: string,
  slackUserId: string,
  spaceSettings: OrgSettings | null,
  formValues: BackblastFormValues,
  eventOrg: { id: number; name: string },
  messageBlocks: ModalView["blocks"],
  messagePlainText: string,
  isEdit: boolean,
  existingTs?: string | null,
): Promise<SendBackblastResult> {
  // Get backblast info for channel determination
  const backblastInfo = await buildBackblastInfo(eventInstanceId, null, teamId);

  // Determine channel
  let backblastChannel: string | null = null;
  if (backblastInfo) {
    backblastChannel = getBackblastChannel(spaceSettings, backblastInfo);
  }

  // Fall back to AO channel from the event org
  if (!backblastChannel) {
    // Try to get channel from the event's org
    try {
      const { org } = await api.org.byId({ id: eventOrg.id });
      if (org?.meta && typeof org.meta === "object") {
        const channelId = (org.meta as Record<string, unknown>)
          .slack_channel_id;
        if (typeof channelId === "string") {
          backblastChannel = channelId;
        }
      }
    } catch {
      // Ignore
    }
  }

  if (!backblastChannel) {
    // No channel - send DM to user explaining the situation
    try {
      await client.chat.postMessage({
        channel: slackUserId,
        text:
          "Your backblast was saved. However, in order to post it to Slack, you will need to set a backblast channel. " +
          "This can be done by region admins; either at the AO level by going to Settings → Calendar Settings → Manage AOs, " +
          "or at the region level by going to Settings → Backblast and Preblast Settings.",
      });
    } catch (error) {
      logger.error("Failed to send backblast info DM", error);
    }
    return { success: true, error: "No channel configured" };
  }

  // Get Q user info for the post author
  let username: string | undefined;
  let iconUrl: string | undefined;
  try {
    const userInfo = await client.users.info({ user: formValues.q });
    const displayName =
      userInfo.user?.profile?.display_name ??
      userInfo.user?.profile?.real_name ??
      userInfo.user?.name ??
      "F3 PAX";
    username = `${displayName} (via F3 Nation)`;
    iconUrl = userInfo.user?.profile?.image_72 ?? undefined;
  } catch (error) {
    logger.warn("Failed to get user info for backblast author", error);
  }

  // Build metadata for the message (convert arrays to comma-separated strings for Slack API compatibility)
  const metadata = {
    event_instance_id: eventInstanceId,
    original_poster: slackUserId,
    q: formValues.q,
    coQs: formValues.coQs.join(","),
    files: formValues.files.join(","),
    file_ids: formValues.slackFileIds.join(","),
  };

  try {
    if (isEdit && existingTs) {
      // Update existing message
      await client.chat.update({
        channel: backblastChannel,
        ts: existingTs,
        blocks: messageBlocks,
        text: messagePlainText,
        metadata: {
          event_type: "backblast",
          event_payload: metadata,
        },
      });
      return {
        success: true,
        messageTs: existingTs,
        channel: backblastChannel,
      };
    }

    // Post new message
    const result = await client.chat.postMessage({
      channel: backblastChannel,
      blocks: messageBlocks,
      text: messagePlainText,
      metadata: {
        event_type: "backblast",
        event_payload: metadata,
      },
      unfurl_links: false,
      username,
      icon_url: iconUrl,
    });

    return { success: true, messageTs: result.ts, channel: backblastChannel };
  } catch (error) {
    logger.error("Failed to send backblast message", {
      eventInstanceId,
      error,
    });
    return { success: false, error: String(error) };
  }
}

/**
 * Handle backblast form submission.
 */
export async function handleBackblastFormSubmit(
  args: TypedViewArgs,
): Promise<void> {
  const { ack, body, client, context } = args;

  // Parse metadata
  const metadata = parseNavMetadata(
    body.view.private_metadata,
  ) as BackblastEditMetadata;
  const callbackId = body.view.callback_id;
  const isEdit = callbackId === ACTIONS.BACKBLAST_EDIT_CALLBACK_ID;
  const isUnscheduled = metadata.isUnscheduled;
  let eventInstanceId = metadata.eventInstanceId;

  const extContext = context as ExtendedContext;
  const teamId = extContext.teamId ?? "";
  const slackUserId = body.user.id;
  const regionOrgId = extContext.orgId;
  const orgSettings = extContext.orgSettings ?? null;

  if (!regionOrgId) {
    logger.error("No region org ID for backblast submission");
    await ack({
      response_action: "errors",
      errors: {
        [ACTIONS.BACKBLAST_TITLE]:
          "Region not configured. Please contact an admin.",
      },
    });
    return;
  }

  // Extract form values
  const formValues = extractFormValues(body);
  const customFields = extractCustomFields(body.view.state.values);

  // Upload any attached files to GCS
  const slackFiles = extractFilesFromValues(
    body.view.state.values as Parameters<typeof extractFilesFromValues>[0],
    ACTIONS.BACKBLAST_FILE,
  );
  if (slackFiles.length > 0) {
    try {
      const space = await api.slack.getSpace(teamId);
      const botToken = space?.botToken;
      if (botToken) {
        const uploadResult = await uploadSlackFiles(slackFiles, botToken, {
          bucket: env.BACKBLAST_BUCKET_NAME,
        });
        formValues.files = uploadResult.urls;
        if (uploadResult.errors.length > 0) {
          logger.warn("Some backblast files failed to upload", {
            errors: uploadResult.errors,
          });
        }
      } else {
        logger.warn("No bot token available for file upload");
      }
    } catch (error) {
      logger.error("Failed to upload backblast files", { error });
    }
  }

  logger.info("Backblast form values extracted", {
    title: formValues.title,
    q: formValues.q,
    paxCount: formValues.pax.length,
    eventInstanceId,
    isUnscheduled,
    isEdit,
  });

  // Calculate PAX count if not provided
  const paxCount = formValues.count ?? calculatePaxCount(formValues);

  // Calculate FNG count
  const fngCount = formValues.fngs.trim()
    ? formValues.fngs.split(",").filter((s) => s.trim()).length
    : 0;

  // Get or create F3 user IDs for all PAX
  const allSlackIds = [formValues.q, ...formValues.coQs, ...formValues.pax];
  const uniqueSlackIds = [...new Set(allSlackIds)];
  const userIdMap = await getOrCreateUserIds(uniqueSlackIds, teamId, client);

  // Parse rich text to plain text for storage
  const moleskinePlainText = await replaceUserChannelIds(
    parseRichBlock(formValues.moleskine),
    client,
  );

  // Determine event org (AO)
  let eventOrgId: number;
  let eventOrgName: string;
  let eventDate: string;
  let eventTypeId: number | undefined;

  if (isUnscheduled) {
    // For unscheduled events, use form values
    if (!formValues.aoId || !formValues.date) {
      await ack({
        response_action: "errors",
        errors: {
          [ACTIONS.BACKBLAST_AO]: "Please select an AO",
          [ACTIONS.BACKBLAST_DATE]: "Please select a date",
        },
      });
      return;
    }
    eventOrgId = formValues.aoId;
    eventDate = formValues.date;
    eventTypeId = formValues.eventTypeId;

    // Get AO name
    try {
      const { org } = await api.org.byId({ id: eventOrgId });
      eventOrgName = org?.name ?? "Unknown AO";
    } catch {
      eventOrgName = "Unknown AO";
    }
  } else {
    // For scheduled events, get from existing event instance
    if (!eventInstanceId) {
      await ack({
        response_action: "errors",
        errors: {
          [ACTIONS.BACKBLAST_TITLE]: "Event instance not found",
        },
      });
      return;
    }

    try {
      const event = await api.eventInstance.byId({ id: eventInstanceId });
      if (!event) {
        throw new Error("Event not found");
      }
      eventOrgId = event.orgId;
      eventOrgName = event.org?.name ?? "Unknown AO";
      eventDate = event.startDate;
      eventTypeId = event.eventTypes?.[0]?.eventTypeId;
    } catch (error) {
      logger.error("Failed to get event instance", { eventInstanceId, error });
      await ack({
        response_action: "errors",
        errors: {
          [ACTIONS.BACKBLAST_TITLE]: "Failed to load event. Please try again.",
        },
      });
      return;
    }
  }

  // Determine if we should send or save for later
  const shouldSend = formValues.sendOption === "Send now";
  const excludeFromPaxVault = formValues.options.includes(
    "exclude_from_pax_vault",
  );

  // Build message blocks and plain text
  const { blocks: messageBlocks, plainText: messagePlainText } =
    buildBackblastMessage(
      formValues,
      eventOrgName,
      eventDate,
      eventTypeId,
      paxCount,
      fngCount,
      moleskinePlainText,
      eventInstanceId ?? 0,
      excludeFromPaxVault,
      orgSettings?.strava_enabled ?? false,
    );

  try {
    // For unscheduled events, create the event instance first
    if (isUnscheduled && !eventInstanceId) {
      const newEvent = await api.eventInstance.crupdate({
        name: formValues.title,
        orgId: eventOrgId,
        startDate: eventDate,
        isActive: true,
        eventTypeId,
      });
      eventInstanceId = newEvent.id;
      logger.info("Created new event instance for unscheduled backblast", {
        eventInstanceId,
      });
    }

    if (!eventInstanceId) {
      throw new Error("No event instance ID");
    }

    // Delete existing actual attendance for re-submission/editing
    // This ensures we recreate all attendance records with the updated PAX list
    try {
      await api.attendance.deleteActualForEvent({ eventInstanceId });
      logger.debug("Deleted existing actual attendance for backblast update", {
        eventInstanceId,
      });
    } catch (error) {
      // May fail if no actual attendance exists yet, which is fine
      logger.debug("No existing actual attendance to delete", {
        eventInstanceId,
        error,
      });
    }

    // Create attendance records for all PAX
    const qUserId = userIdMap.get(formValues.q);
    const coQUserIds = formValues.coQs
      .map((id) => userIdMap.get(id))
      .filter((id): id is number => id !== undefined);

    // Create actual attendance for Q
    if (qUserId) {
      try {
        await api.attendance.createActual({
          eventInstanceId,
          userId: qUserId,
          attendanceTypeIds: [ATTENDANCE_TYPES.PAX, ATTENDANCE_TYPES.Q],
        });
      } catch (error) {
        logger.error(`Failed to create Q attendance for user ${qUserId}`, {
          error,
        });
      }
    }

    // Create actual attendance for Co-Qs
    for (const coQUserId of coQUserIds) {
      if (coQUserId !== qUserId) {
        try {
          await api.attendance.createActual({
            eventInstanceId,
            userId: coQUserId,
            attendanceTypeIds: [ATTENDANCE_TYPES.PAX, ATTENDANCE_TYPES.COQ],
          });
        } catch (error) {
          logger.error(
            `Failed to create Co-Q attendance for user ${coQUserId}`,
            { error },
          );
        }
      }
    }

    // Create actual PAX attendance records
    for (const slackId of formValues.pax) {
      const userId = userIdMap.get(slackId);
      if (userId && userId !== qUserId && !coQUserIds.includes(userId)) {
        try {
          await api.attendance.createActual({
            eventInstanceId,
            userId,
            attendanceTypeIds: [ATTENDANCE_TYPES.PAX],
          });
        } catch (error) {
          logger.error(`Failed to create PAX attendance for user ${userId}`, {
            error,
          });
        }
      }
    }

    // Build meta object
    const eventMeta: Record<string, unknown> = {
      ...customFields,
      exclude_from_pax_vault: excludeFromPaxVault,
    };

    // Handle "Save and send later"
    if (!shouldSend) {
      // Save moleskin to meta for later retrieval
      eventMeta.saved_moleskin = formValues.moleskine;

      // Update event instance without backblast_ts
      await api.eventInstance.crupdate({
        id: eventInstanceId,
        orgId: eventOrgId,
        startDate: eventDate,
        name: formValues.title,
        meta: eventMeta,
        paxCount,
        // Don't set backblast_ts - indicates not posted
      });

      // Send DM to user confirming save
      try {
        await client.chat.postMessage({
          channel: slackUserId,
          text: `Your backblast "${formValues.title}" has been saved and will be posted later. You can find it in your past Qs when you're ready to post.`,
        });
      } catch (error) {
        logger.warn("Failed to send save confirmation DM", error);
      }

      await ack({ response_action: "clear" });
      return;
    }

    // Send the backblast message
    const sendResult = await sendBackblast(
      client,
      eventInstanceId,
      teamId,
      slackUserId,
      orgSettings,
      formValues,
      { id: eventOrgId, name: eventOrgName },
      messageBlocks,
      messagePlainText,
      isEdit,
      metadata.backblastTs,
    );

    // Add slack_channel_id to meta if backblast was posted
    if (sendResult.success && sendResult.channel) {
      eventMeta.slack_channel_id = sendResult.channel;
    }

    // Update event instance with all backblast data
    await api.eventInstance.crupdate({
      id: eventInstanceId,
      orgId: eventOrgId,
      startDate: eventDate,
      name: formValues.title,
      meta: eventMeta,
      paxCount,
      fngCount,
      backblast: moleskinePlainText,
      backblastRich: messageBlocks as unknown as Record<string, unknown>[],
      // Convert message timestamp to number if available
      backblastTs: sendResult.messageTs
        ? parseFloat(sendResult.messageTs)
        : null,
    });

    // TODO: Send email if enabled and requested
    if (formValues.emailSend === "yes" && orgSettings?.email_enable) {
      logger.info("Email sending requested but not yet implemented", {
        eventInstanceId,
      });
      // TODO: Implement email sending via @acme/mail
    }

    if (!sendResult.success && sendResult.error !== "No channel configured") {
      logger.error("Failed to send backblast", {
        eventInstanceId,
        error: sendResult.error,
      });
    }
  } catch (error) {
    logger.error("Failed to save backblast", { eventInstanceId, error });
    await ack({
      response_action: "errors",
      errors: {
        [ACTIONS.BACKBLAST_TITLE]:
          "Failed to save backblast. Please try again.",
      },
    });
    return;
  }

  // Close the modal
  await ack({ response_action: "clear" });
}

/**
 * Handle backblast edit button click.
 * Checks permissions and opens the edit form.
 */
export async function handleBackblastEditButton(
  args: TypedActionArgs,
): Promise<void> {
  const { ack, body, client, context, action } = args;
  await ack();

  const actionWithValue = action as {
    action_id: string;
    value?: string;
  };

  const extContext = context as ExtendedContext;
  const currentUserId = extContext.slackUser?.userId;
  const teamId = extContext.teamId ?? "";
  const slackUserId = body.user.id;
  const regionOrgId = extContext.orgId ?? 0;
  const orgSettings = extContext.orgSettings ?? null;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const isAdmin = extContext.isAdmin ?? false;

  // Parse backblast data from button value or message metadata
  let backblastData: BackblastMessageMetadata | null = null;
  let messageTs: string | undefined;

  // Try to get from message metadata first
  const bodyWithMessage = body as {
    message?: {
      metadata?: { event_payload?: BackblastMessageMetadata };
      ts?: string;
    };
    channel?: { id: string };
  };
  if (bodyWithMessage.message?.metadata?.event_payload) {
    backblastData = bodyWithMessage.message.metadata.event_payload;
    messageTs = bodyWithMessage.message.ts;
  }

  // Fall back to button value (JSON encoded)
  if (!backblastData && actionWithValue.value) {
    try {
      backblastData = JSON.parse(
        actionWithValue.value,
      ) as BackblastMessageMetadata;
    } catch {
      logger.warn("Failed to parse backblast edit button value");
    }
  }

  if (!backblastData?.event_instance_id) {
    logger.error("No backblast data for edit button");
    return;
  }

  const eventInstanceId = backblastData.event_instance_id;

  // Permission check: Q, Co-Q, original poster, or admin
  // coQs is stored as comma-separated string
  const coQsList = backblastData.coQs?.split(",").filter(Boolean) ?? [];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const canEdit =
    isAdmin ||
    slackUserId === backblastData.original_poster ||
    slackUserId === backblastData.q ||
    coQsList.includes(slackUserId);

  if (!canEdit) {
    // Send ephemeral message explaining why they can't edit
    try {
      await client.chat.postEphemeral({
        channel:
          (body as { channel?: { id: string } }).channel?.id ?? slackUserId,
        user: slackUserId,
        text: "You don't have permission to edit this backblast. Only the Q, Co-Qs, original poster, or region admins can edit.",
      });
    } catch (error) {
      logger.warn("Failed to send edit permission error", error);
    }
    return;
  }

  // Build and open the edit form
  const backblastInfo = await buildBackblastInfo(
    eventInstanceId,
    currentUserId ?? null,
    teamId,
    backblastData.original_poster,
  );

  if (!backblastInfo) {
    logger.error("Failed to build backblast info for edit", {
      eventInstanceId,
    });
    return;
  }

  try {
    const modal = await buildBackblastEditModal(
      backblastInfo,
      { _navDepth: 0 },
      orgSettings,
      regionOrgId,
      true, // isEdit
      slackUserId,
      messageTs, // Pass the message timestamp for updating the original post
    );

    // Get trigger_id from the body
    const bodyWithTrigger = body as { trigger_id?: string };
    const triggerId = bodyWithTrigger.trigger_id;
    if (!triggerId) {
      logger.error("No trigger_id for edit button");
      return;
    }

    await client.views.open({
      trigger_id: triggerId,
      view: modal,
    });
  } catch (error) {
    logger.error("Failed to open backblast edit modal", { error });
  }
}

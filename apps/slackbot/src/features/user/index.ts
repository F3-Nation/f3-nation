/**
 * User Profile Feature
 *
 * Handles user profile management:
 * - Edit F3 name, home region, avatar
 * - Emergency contact information
 * - Start date override
 *
 * Migrated from Python features/user.py
 */

import type { App } from "@slack/bolt";
import type { ModalView } from "@slack/types";
import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import { extractFilesFromValues, uploadSlackFile } from "../../lib/file-upload";
import type { SlackFile } from "../../lib/file-upload";
import { logger } from "../../lib/logger";
import type {
  BlockList,
  ExtendedContext,
  SlackStateValues,
  TypedActionArgs,
  TypedViewArgs,
} from "../../types/bolt-types";
import { extractTeamId, extractUserId } from "../../types/bolt-types";
import { createNavContext, navigateToView } from "../../lib/view-navigation";

/** Meta key for start date override */
const USER_META_START_DATE = "start_date_override";

/**
 * Build the user profile modal.
 * Fetches current user data to pre-populate the form.
 */
export async function buildUserProfileModal(
  context: ExtendedContext,
): Promise<ModalView> {
  try {
    return await _buildUserProfileModalInner(context);
  } catch (error) {
    logger.error("Unexpected error building user profile form:", error);
    return {
      type: "modal",
      callback_id: ACTIONS.USER_PROFILE_CALLBACK_ID,
      title: { type: "plain_text", text: "My Profile" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:x: An error occurred loading your profile: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        },
      ],
      close: { type: "plain_text", text: "Close" },
    };
  }
}

async function _buildUserProfileModalInner(
  context: ExtendedContext,
): Promise<ModalView> {
  const teamId = context.teamId;
  const slackUser = context.slackUser;

  if (!teamId || !slackUser) {
    return {
      type: "modal",
      callback_id: ACTIONS.USER_PROFILE_CALLBACK_ID,
      title: { type: "plain_text", text: "My Profile" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Unable to load your profile. Please try again.",
          },
        },
      ],
      close: { type: "plain_text", text: "Close" },
    };
  }

  // Fetch the user's full profile
  let profile: Awaited<ReturnType<typeof api.slack.getSelfProfile>>;
  try {
    profile = await api.slack.getSelfProfile(teamId, slackUser.slackId);
  } catch (error) {
    logger.error("Failed to fetch user profile:", error);
    return {
      type: "modal",
      callback_id: ACTIONS.USER_PROFILE_CALLBACK_ID,
      title: { type: "plain_text", text: "My Profile" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Failed to load your profile. Please try again.",
          },
        },
      ],
      close: { type: "plain_text", text: "Close" },
    };
  }

  const blocks: BlockList = [];

  // F3 Name input (required)
  blocks.push({
    type: "input",
    block_id: ACTIONS.USER_PROFILE_F3_NAME,
    label: { type: "plain_text", text: "F3 Name" },
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.USER_PROFILE_F3_NAME,
      placeholder: { type: "plain_text", text: "Enter your F3 name" },
      ...(profile.f3Name && { initial_value: profile.f3Name }),
    },
    hint: {
      type: "plain_text",
      text: "This is the username that will be used to identify you globally. Do not include your home region.",
    },
  });

  // Home Region external select
  blocks.push({
    type: "input",
    block_id: ACTIONS.USER_PROFILE_HOME_REGION,
    label: { type: "plain_text", text: "Home Region" },
    element: {
      type: "external_select",
      action_id: ACTIONS.USER_PROFILE_HOME_REGION,
      placeholder: { type: "plain_text", text: "Select your home region" },
      min_query_length: 1,
      ...(profile.homeRegionId &&
        profile.homeRegionName && {
          initial_option: {
            text: { type: "plain_text", text: profile.homeRegionName },
            value: String(profile.homeRegionId),
          },
        }),
    },
    hint: {
      type: "plain_text",
      text: "This is the region you will be associated with. You can change this at any time.",
    },
    optional: true,
  });

  // Start Date Override
  const startDateOverride = profile.meta?.[USER_META_START_DATE];
  const startDateStr =
    typeof startDateOverride === "string" ? startDateOverride : undefined;
  blocks.push({
    type: "input",
    block_id: ACTIONS.USER_PROFILE_START_DATE,
    label: { type: "plain_text", text: "Start Date Override" },
    element: {
      type: "datepicker",
      action_id: ACTIONS.USER_PROFILE_START_DATE,
      placeholder: { type: "plain_text", text: "Select your start date" },
      ...(startDateStr && { initial_date: startDateStr }),
    },
    hint: {
      type: "plain_text",
      text: "This only needs to be filled if you need to override your official start date for any reason.",
    },
    optional: true,
  });

  // Stats button (if STATS_URL is configured)
  const statsUrl = process.env.STATS_URL;
  if (statsUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: ":bar_chart: My Stats :link:" },
          url: `${statsUrl}/stats/pax/${profile.id}`,
          action_id: ACTIONS.USER_PROFILE_STATS_BUTTON,
        },
      ],
    });
  }

  // Current avatar image (if available)
  if (profile.avatarUrl) {
    // Try to verify the URL is accessible
    try {
      const headRes = await fetch(profile.avatarUrl, { method: "HEAD" });
      if (headRes.ok) {
        blocks.push({
          type: "image",
          block_id: ACTIONS.USER_PROFILE_IMAGE,
          image_url: profile.avatarUrl,
          alt_text: "Your Profile Picture",
        });
        blocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "_This avatar is used in the Nation dashboard and can be different from your Slack avatar._",
            },
          ],
        });
      }
    } catch {
      // Image URL not accessible, skip showing it
      logger.warn(`Profile avatar URL not accessible: ${profile.avatarUrl}`);
    }
  }

  // New profile picture upload
  blocks.push({
    type: "input",
    block_id: ACTIONS.USER_PROFILE_IMAGE_UPLOAD,
    label: { type: "plain_text", text: "New Profile Picture" },
    element: {
      type: "file_input",
      action_id: ACTIONS.USER_PROFILE_IMAGE_UPLOAD,
      max_files: 1,
      filetypes: ["png", "jpg", "jpeg", "heic", "bmp"],
    },
    optional: true,
  });

  // Divider before emergency contacts
  blocks.push({ type: "divider" });

  // Emergency Contact fields
  blocks.push({
    type: "input",
    block_id: ACTIONS.USER_PROFILE_EMERGENCY_CONTACT,
    label: { type: "plain_text", text: "Emergency Contact" },
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.USER_PROFILE_EMERGENCY_CONTACT,
      placeholder: {
        type: "plain_text",
        text: "Enter an emergency contact name",
      },
      ...(profile.emergencyContact && {
        initial_value: profile.emergencyContact,
      }),
    },
    optional: true,
  });

  blocks.push({
    type: "input",
    block_id: ACTIONS.USER_PROFILE_EMERGENCY_PHONE,
    label: { type: "plain_text", text: "Emergency Contact Phone" },
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.USER_PROFILE_EMERGENCY_PHONE,
      placeholder: {
        type: "plain_text",
        text: "Enter an emergency contact phone number",
      },
      ...(profile.emergencyPhone && {
        initial_value: profile.emergencyPhone,
      }),
    },
    optional: true,
  });

  blocks.push({
    type: "input",
    block_id: ACTIONS.USER_PROFILE_EMERGENCY_NOTES,
    label: { type: "plain_text", text: "Emergency Contact Notes" },
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.USER_PROFILE_EMERGENCY_NOTES,
      placeholder: {
        type: "plain_text",
        text: "Enter any notes in case of an emergency (e.g., allergies, medical conditions)",
      },
      multiline: true,
      ...(profile.emergencyNotes && {
        initial_value: profile.emergencyNotes,
      }),
    },
    optional: true,
  });

  return {
    type: "modal",
    callback_id: ACTIONS.USER_PROFILE_CALLBACK_ID,
    title: { type: "plain_text", text: "My Profile" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  };
}

/**
 * Handle user profile form submission
 */
async function handleUserProfileSubmit({ ack, view, body }: TypedViewArgs) {
  await ack();

  const teamId = extractTeamId(body);
  const slackId = extractUserId(body);

  if (!teamId || !slackId) {
    logger.error("Missing teamId or slackId in user profile submission");
    return;
  }

  const values = view.state.values as unknown as SlackStateValues;

  // Extract form values
  const f3Name =
    values[ACTIONS.USER_PROFILE_F3_NAME]?.[ACTIONS.USER_PROFILE_F3_NAME]
      ?.value ?? undefined;

  const homeRegionSelected =
    values[ACTIONS.USER_PROFILE_HOME_REGION]?.[ACTIONS.USER_PROFILE_HOME_REGION]
      ?.selected_option;
  const homeRegionId = homeRegionSelected?.value
    ? parseInt(homeRegionSelected.value, 10)
    : undefined;

  const startDate =
    values[ACTIONS.USER_PROFILE_START_DATE]?.[ACTIONS.USER_PROFILE_START_DATE]
      ?.selected_date ?? undefined;

  const emergencyContact =
    values[ACTIONS.USER_PROFILE_EMERGENCY_CONTACT]?.[
      ACTIONS.USER_PROFILE_EMERGENCY_CONTACT
    ]?.value ?? undefined;

  const emergencyPhone =
    values[ACTIONS.USER_PROFILE_EMERGENCY_PHONE]?.[
      ACTIONS.USER_PROFILE_EMERGENCY_PHONE
    ]?.value ?? undefined;

  const emergencyNotes =
    values[ACTIONS.USER_PROFILE_EMERGENCY_NOTES]?.[
      ACTIONS.USER_PROFILE_EMERGENCY_NOTES
    ]?.value ?? undefined;

  // Handle file upload if present
  let avatarUrl: string | undefined;
  const files = extractFilesFromValues(
    values as Record<string, Record<string, { files?: SlackFile[] }>>,
    ACTIONS.USER_PROFILE_IMAGE_UPLOAD,
  );

  if (files.length > 0) {
    try {
      // Get bot token for downloading the file
      const space = await api.slack.getSpace(teamId);
      if (space?.botToken) {
        const uploadResult = await uploadSlackFile(files[0]!, space.botToken, {
          enforceSquare: true, // Profile pictures should be square
          maxHeight: 400, // Reasonable size for avatars
        });
        if (uploadResult?.url) {
          avatarUrl = uploadResult.url;
        }
      }
    } catch (error) {
      logger.error("Failed to upload profile picture:", error);
      // Continue with other updates even if upload fails
    }
  }

  // Build update payload
  const updatePayload: Parameters<typeof api.slack.updateSelfProfile>[0] = {
    teamId,
    slackId,
    f3Name,
    homeRegionId,
    emergencyContact,
    emergencyPhone,
    emergencyNotes,
    ...(avatarUrl && { avatarUrl }),
    ...(startDate && {
      meta: { [USER_META_START_DATE]: startDate },
    }),
  };

  try {
    await api.slack.updateSelfProfile(updatePayload);
    logger.info(`User profile updated for ${slackId}`);
  } catch (error) {
    logger.error("Failed to update user profile:", error);
    // Could send a DM to the user with error details
  }
}

/**
 * Register user profile feature handlers
 */
export function registerUserFeature(app: App) {
  // Action: Open user profile modal from config
  app.action(ACTIONS.OPEN_USER_PROFILE, async (args: TypedActionArgs) => {
    const { ack, context } = args;
    await ack();
    const navCtx = createNavContext(args);
    await navigateToView(
      navCtx,
      () => buildUserProfileModal(context as ExtendedContext),
      { showLoading: true, loadingTitle: "Loading Profile..." },
    );
  });

  // View submission handler
  app.view(ACTIONS.USER_PROFILE_CALLBACK_ID, handleUserProfileSubmit);

  // Ignore stats button click (it's a link button)
  app.action(ACTIONS.USER_PROFILE_STATS_BUTTON, async ({ ack }) => {
    await ack();
  });

  // Options handler for home region external_select
  app.options(ACTIONS.USER_PROFILE_HOME_REGION, async ({ ack, options }) => {
    const searchTerm = options.value;
    logger.debug(`Home region search query: "${searchTerm}"`);

    try {
      const regions = await api.slack.searchRegions({
        searchTerm: searchTerm ?? "",
      });

      const optionsList = regions.map((region) => ({
        text: {
          type: "plain_text" as const,
          text: region.name,
        },
        value: String(region.id),
      }));

      await ack({
        options: optionsList,
      });
    } catch (error) {
      logger.error("Error searching regions:", error);
      await ack({ options: [] });
    }
  });
}

import type { App, BlockAction } from "@slack/bolt";
import { ACTIONS } from "../../constants/actions";
import { buildWelcomeConfigModal } from "../welcome";
import { buildCalendarConfigModal } from "../calendar";
import { api } from "../../lib/api-client";
import { logger } from "../../lib/logger";
import type { RegionSettings } from "../../types";
import type {
  BlockList,
  ExtendedContext,
  SlackStateValues,
  TypedActionArgs,
  TypedCommandArgs,
  TypedViewArgs,
} from "../../types/bolt-types";
import type { ModalView } from "@slack/types";
import { createNavContext, navigateToView } from "../../lib/view-navigation";
import {
  extractTeamId,
  extractUserId,
  stringifyNavMetadata,
} from "../../types/bolt-types";

// Check if running in local development mode
const isLocalDevelopment =
  process.env.LOCAL_DEVELOPMENT?.toLowerCase() === "true";

/**
 * Build the region setup modal for unconnected Slack workspaces (local dev only)
 */
export function buildRegionSetupModal(): ModalView {
  const blocks: BlockList = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":wave: *Welcome to F3 Nation Slackbot!*\n\nThis Slack workspace is not yet connected to an F3 region. Please select an existing region or create a new one to get started.",
      },
    },
    {
      type: "divider",
    },
    {
      type: "input",
      block_id: ACTIONS.REGION_SETUP_SEARCH as string,
      optional: true,
      label: {
        type: "plain_text",
        text: "Search for an existing region",
      },
      element: {
        type: "external_select",
        action_id: ACTIONS.REGION_SETUP_SEARCH as string,
        placeholder: {
          type: "plain_text",
          text: "Type to search regions...",
        },
        min_query_length: 1,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_— or —_",
        },
      ],
    },
    {
      type: "input",
      block_id: ACTIONS.REGION_SETUP_NEW_NAME as string,
      optional: true,
      label: {
        type: "plain_text",
        text: "Create a new region",
      },
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.REGION_SETUP_NEW_NAME as string,
        placeholder: {
          type: "plain_text",
          text: "Enter new region name",
        },
      },
    },
  ];

  return {
    type: "modal",
    callback_id: ACTIONS.REGION_SETUP_CALLBACK_ID as string,
    title: { type: "plain_text", text: "Connect to Region" },
    submit: { type: "plain_text", text: "Connect" },
    close: { type: "plain_text", text: "Cancel" },
    blocks,
  } as ModalView;
}

/**
 * Build the main configuration menu modal
 */
export function buildConfigModal(context: ExtendedContext) {
  // In local development mode, if no org is connected, show setup modal
  if (isLocalDevelopment && !context.orgId) {
    return buildRegionSetupModal();
  }

  const slackUser = context.slackUser;
  const isAdmin = slackUser?.isAdmin ?? false;

  const blocks: BlockList = [];

  if (isAdmin) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":speech_balloon: Welcomebot Settings",
          },
          action_id: ACTIONS.OPEN_WELCOME_CONFIG,
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":gear: General Settings" },
          action_id: ACTIONS.OPEN_GENERAL_CONFIG,
        },
        {
          type: "button",
          text: { type: "plain_text", text: ":calendar: Calendar Settings" },
          action_id: ACTIONS.OPEN_CALENDAR_CONFIG,
        },
      ],
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "You do not have permission to access region settings. Please contact your region admin.",
      },
    });
  }

  return {
    type: "modal" as const,
    callback_id: ACTIONS.CONFIG_CALLBACK_ID,
    title: { type: "plain_text" as const, text: "F3 Nation Settings" },
    blocks,
  } as ModalView;
}

/**
 * Register Config feature
 */
export function registerConfigFeature(app: App) {
  // Slash command
  app.command(
    "/f3-nation-settings",
    async ({ ack, body, client, context }: TypedCommandArgs) => {
      await ack();
      const modal = buildConfigModal(context);
      // Initialize with depth 1
      modal.private_metadata = stringifyNavMetadata({ _navDepth: 1 });
      await client.views.open({
        trigger_id: body.trigger_id,
        view: modal,
      });
    },
  );

  // Global shortcut
  app.shortcut("settings_shortcut", async (args) => {
    const { ack, shortcut, client, context } = args;
    await ack();
    const modal = buildConfigModal(context as ExtendedContext);
    // Initialize with depth 1
    modal.private_metadata = stringifyNavMetadata({ _navDepth: 1 });
    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: modal,
    });
  });

  // Action: Open Main Config Modal (from Settings button)
  app.action(ACTIONS.SETTINGS_BUTTON, async (args: TypedActionArgs) => {
    const { ack, client, body, context } = args;
    await ack();
    const modal = buildConfigModal(context);
    modal.private_metadata = stringifyNavMetadata({ _navDepth: 1 });
    await client.views.open({
      trigger_id: (body as BlockAction).trigger_id,
      view: modal,
    });
  });

  // Action: Open Welcome Config
  app.action(ACTIONS.OPEN_WELCOME_CONFIG, async (args: TypedActionArgs) => {
    const { ack, context } = args;
    await ack();
    const navCtx = createNavContext(args);
    await navigateToView(navCtx, () =>
      buildWelcomeConfigModal(context.regionSettings),
    );
  });

  // Action: Open General Config
  app.action(ACTIONS.OPEN_GENERAL_CONFIG, async (args: TypedActionArgs) => {
    const { ack, context } = args;
    await ack();
    const navCtx = createNavContext(args);
    await navigateToView(navCtx, () =>
      buildGeneralConfigModal(context.regionSettings),
    );
  });

  // Action: Open Calendar Config
  app.action(ACTIONS.OPEN_CALENDAR_CONFIG, async (args: TypedActionArgs) => {
    const { ack, context } = args;
    await ack();
    const navCtx = createNavContext(args);
    await navigateToView(navCtx, () => buildCalendarConfigModal(context));
  });

  // Action handler for saving general settings
  app.view(
    ACTIONS.CONFIG_CALLBACK_ID,
    async ({ ack, view, body }: TypedViewArgs) => {
      await ack();
      // Implementation for saving general settings
      const teamId = body.team?.id;
      if (!teamId) return;

      const values = view.state.values as unknown as SlackStateValues;
      const editingLocked =
        values[ACTIONS.CONFIG_EDITING_LOCKED]?.[ACTIONS.CONFIG_EDITING_LOCKED]
          ?.selected_option?.value === "yes";

      try {
        await api.slack.updateSpaceSettings(teamId, {
          editing_locked: editingLocked,
          // Add other fields as needed
        });
        logger.info(`Updated general settings for team ${teamId}`);
      } catch (error) {
        logger.error("Error saving general settings:", error);
      }
    },
  );

  // Options handler for region search external_select
  app.options(
    ACTIONS.REGION_SETUP_SEARCH as string,
    async ({ ack, options }) => {
      const searchTerm = options.value;
      logger.debug(`Region search query: "${searchTerm}"`);

      try {
        const result = await api.org.all({
          orgTypes: ["region"],
          searchTerm: searchTerm || undefined,
          pageSize: 20,
          statuses: ["active"],
        });

        const optionsList = result.orgs.map((org) => ({
          text: {
            type: "plain_text" as const,
            text: org.name,
          },
          value: org.id.toString(),
        }));

        await ack({
          options: optionsList,
        });
      } catch (error) {
        logger.error("Error searching regions:", error);
        await ack({ options: [] });
      }
    },
  );

  // View submission handler for region setup
  app.view(
    ACTIONS.REGION_SETUP_CALLBACK_ID as string,
    async ({ ack, view, body, client, context }: TypedViewArgs) => {
      const teamId = extractTeamId(body);
      const userId = extractUserId(body);
      const extContext = context as ExtendedContext;

      if (!teamId) {
        await ack({
          response_action: "errors",
          errors: {
            [ACTIONS.REGION_SETUP_SEARCH as string]:
              "Unable to identify Slack workspace.",
          },
        });
        return;
      }

      const values = view.state.values as unknown as SlackStateValues;

      // Get selected region or new region name
      const searchBlockId = ACTIONS.REGION_SETUP_SEARCH as string;
      const newNameBlockId = ACTIONS.REGION_SETUP_NEW_NAME as string;

      const selectedRegionId =
        values[searchBlockId]?.[searchBlockId]?.selected_option?.value;
      const newRegionName =
        values[newNameBlockId]?.[newNameBlockId]?.value?.trim();

      // Validate: must have one or the other, not both
      if (!selectedRegionId && !newRegionName) {
        await ack({
          response_action: "errors",
          errors: {
            [newNameBlockId]:
              "Please select an existing region or enter a name for a new one.",
          },
        });
        return;
      }

      if (selectedRegionId && newRegionName) {
        await ack({
          response_action: "errors",
          errors: {
            [newNameBlockId]:
              "Please either select an existing region OR create a new one, not both.",
          },
        });
        return;
      }

      try {
        // Connect space to org (existing or new)
        const connectResult: { success: boolean; orgId: number } =
          await api.slack.connectSpaceToOrg({
            teamId,
            orgId: selectedRegionId
              ? parseInt(selectedRegionId, 10)
              : undefined,
            newOrgName: newRegionName ?? undefined,
            orgType: "region",
          });

        logger.info(
          `Connected team ${teamId} to org ${connectResult.orgId}${newRegionName ? ` (new: ${newRegionName})` : ""}`,
        );

        // Assign admin role to the current user if we have their F3 user ID
        const f3UserId = extContext.slackUser?.userId;
        if (f3UserId) {
          try {
            await api.slack.assignUserRole({
              userId: f3UserId,
              orgId: connectResult.orgId,
              roleName: "admin",
            });
            logger.info(
              `Assigned admin role to user ${f3UserId} on org ${connectResult.orgId}`,
            );

            // Invalidate user caches so they get fresh admin status
            if (userId) {
              api.slack.invalidateUserCache(teamId, userId);
            }
          } catch (roleError) {
            logger.error("Error assigning admin role:", roleError);
            // Don't fail the whole operation if role assignment fails
          }
        } else {
          logger.warn(
            `No F3 user ID found for Slack user ${userId} - cannot assign admin role`,
          );
        }

        // Close the modal with a success message
        await ack();

        // Post a success message to the user
        if (userId) {
          try {
            await client.chat.postMessage({
              channel: userId,
              text: `:white_check_mark: Successfully connected this Slack workspace to ${newRegionName ? `the new region "${newRegionName}"` : "the selected region"}! You've been granted admin permissions. Use \`/f3-nation-settings\` to configure your region.`,
            });
          } catch (msgError) {
            logger.warn("Could not send success DM:", msgError);
          }
        }
      } catch (error) {
        logger.error("Error connecting space to org:", error);
        await ack({
          response_action: "errors",
          errors: {
            [searchBlockId]: "Failed to connect to region. Please try again.",
          },
        });
      }
    },
  );
}

/**
 * Build the General Settings modal
 */
export function buildGeneralConfigModal(regionSettings?: RegionSettings) {
  return {
    type: "modal" as const,
    callback_id: ACTIONS.CONFIG_CALLBACK_ID, // Reusing callback ID or use a specific one
    title: { type: "plain_text" as const, text: "General Settings" },
    submit: { type: "plain_text" as const, text: "Save" },
    close: { type: "plain_text" as const, text: "Back" },
    blocks: [
      {
        type: "input",
        block_id: ACTIONS.CONFIG_EDITING_LOCKED,
        label: { type: "plain_text", text: "Lock editing of backblasts?" },
        element: {
          type: "radio_buttons",
          action_id: ACTIONS.CONFIG_EDITING_LOCKED,
          initial_option: {
            text: {
              type: "plain_text",
              text: regionSettings?.editing_locked ? "Yes" : "No",
            },
            value: regionSettings?.editing_locked ? "yes" : "no",
          },
          options: [
            { text: { type: "plain_text", text: "Yes" }, value: "yes" },
            { text: { type: "plain_text", text: "No" }, value: "no" },
          ],
        },
      },
      // Add more settings here based on RegionSettings
    ] as BlockList,
  } as ModalView;
}

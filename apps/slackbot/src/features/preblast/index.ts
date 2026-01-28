/**
 * Preblast Feature
 *
 * Handles preblast creation workflows:
 * - /preblast command
 * - preblast_shortcut global shortcut
 * - "New Preblast" button actions
 * - Preblast edit form
 * - Preblast action buttons (Take Q, HC, etc.)
 *
 * Entry points all route to the preblast selection form,
 * which shows the user's upcoming Q assignments.
 */

import type { App } from "@slack/bolt";
import type { ModalView } from "@slack/types";

import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import { logger } from "../../lib/logger";
import { createNavContext, navigateToView } from "../../lib/view-navigation";
import type { NavigationContext } from "../../lib/view-navigation";
import type {
  ExtendedContext,
  NavigationMetadata,
  TypedActionArgs,
  TypedCommandArgs,
  TypedViewArgs,
} from "../../types/bolt-types";
import { buildPreblastSelectModal } from "./select-form";
import { buildPreblastEditModal } from "./edit-form";
import {
  handlePreblastFormSubmit,
  handlePreblastAction,
} from "./edit-form-handlers";

/**
 * Open the preblast selection form.
 * Fetches user's upcoming Qs and builds the selection modal.
 */
async function openPreblastSelectForm(
  navCtx: NavigationContext,
  context: ExtendedContext,
): Promise<void> {
  const userId = context.slackUser?.userId;
  const regionOrgId = context.orgId;

  if (!userId || !regionOrgId) {
    logger.warn("Cannot open preblast form: missing userId or regionOrgId", {
      userId,
      regionOrgId,
    });
    // Still show the modal but with empty state
    await navigateToView(
      navCtx,
      (metadata: NavigationMetadata): ModalView =>
        buildPreblastSelectModal([], metadata),
      { showLoading: true, loadingTitle: "Loading Preblasts..." },
    );
    return;
  }

  await navigateToView(
    navCtx,
    async (metadata: NavigationMetadata): Promise<ModalView> => {
      try {
        const response = await api.eventInstance.getUpcomingQs({
          userId,
          regionOrgId,
          notPostedOnly: true,
        });
        return buildPreblastSelectModal(response.eventInstances, metadata);
      } catch (error) {
        logger.error("Failed to fetch upcoming Qs", error);
        // Return empty state on error
        return buildPreblastSelectModal([], metadata);
      }
    },
    { showLoading: true, loadingTitle: "Loading Preblasts..." },
  );
}

/**
 * Handle selection from the preblast select form.
 * Routes to the preblast edit form for the selected event.
 */
async function handlePreblastSelect(args: TypedActionArgs): Promise<void> {
  const { ack, action, client, context, body } = args;
  await ack();

  // Extract the action_id to determine what was selected
  const actionWithId = action as {
    action_id?: string;
    value?: string;
    selected_option?: { value: string };
  };
  const actionId = actionWithId.action_id ?? "";

  let eventInstanceId: number | undefined;

  // Check if this is a quick-select button (action_id starts with EVENT_PREBLAST_FILL_BUTTON)
  if (actionId.startsWith(ACTIONS.EVENT_PREBLAST_FILL_BUTTON as string)) {
    // For buttons, the value contains the event instance ID
    eventInstanceId = parseInt(actionWithId.value ?? "0", 10);
  }

  // Check if this is the static_select dropdown
  if (actionId === `${ACTIONS.EVENT_PREBLAST_FILL_BUTTON}_select`) {
    eventInstanceId = parseInt(actionWithId.selected_option?.value ?? "0", 10);
  }

  // Check for events without Q dropdown
  if (actionId === ACTIONS.EVENT_PREBLAST_NOQ_SELECT) {
    eventInstanceId = parseInt(actionWithId.selected_option?.value ?? "0", 10);
  }

  if (eventInstanceId && eventInstanceId > 0) {
    logger.info("Preblast selected", { eventInstanceId });

    const extContext = context as ExtendedContext;
    const currentUserId = extContext.slackUser?.userId ?? null;
    const teamId = extContext.teamId ?? "";
    const regionOrgId = extContext.orgId ?? 0;

    const navCtx = createNavContext({
      client,
      body,
      context,
    });

    await navigateToView(
      navCtx,
      async (navMetadata: NavigationMetadata): Promise<ModalView> => {
        const modal = await buildPreblastEditModal(
          eventInstanceId!,
          currentUserId,
          teamId,
          navMetadata,
          extContext.orgSettings ?? null,
          regionOrgId,
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
      { showLoading: true, loadingTitle: "Loading Preblast..." },
    );
    return;
  }

  // Handle "New Unscheduled Event" button
  if (actionId === ACTIONS.EVENT_PREBLAST_NEW_BUTTON) {
    logger.info("New unscheduled event preblast requested");
    // TODO: Route to unscheduled event preblast form
    // For now, just log - will implement in later phase
  }

  // Handle "Open Calendar" button - this is handled by calendar feature
  // Just log for now
  if (actionId === ACTIONS.OPEN_CALENDAR_BUTTON) {
    logger.info("Open calendar requested from preblast select");
  }
}

/**
 * Register preblast feature handlers with the Bolt app
 */
export function registerPreblastFeature(app: App): void {
  // Slash command - /preblast
  app.command(
    "/preblast",
    async ({ command, ack, client, context }: TypedCommandArgs) => {
      await ack();

      logger.info("Preblast command received", {
        user: command.user_id,
        team: command.team_id,
      });

      const navCtx = createNavContext({
        client,
        body: { trigger_id: command.trigger_id } as TypedCommandArgs["body"],
        context,
      });

      await openPreblastSelectForm(navCtx, context as ExtendedContext);
    },
  );

  // Global shortcut - preblast_shortcut
  app.shortcut(
    ACTIONS.PREBLAST_SHORTCUT,
    async ({ ack, shortcut, client, context }) => {
      await ack();

      logger.info("Preblast shortcut triggered", {
        user: shortcut.user.id,
      });

      const navCtx = createNavContext({
        client,
        body: shortcut,
        context,
      });

      await openPreblastSelectForm(navCtx, context as ExtendedContext);
    },
  );

  // Action - new-preblast button (from help menu, etc.)
  app.action(
    ACTIONS.PREBLAST_NEW_BUTTON,
    async ({ ack, body, client, context }: TypedActionArgs) => {
      await ack();

      logger.info("New preblast button clicked");

      const navCtx = createNavContext({
        client,
        body,
        context,
      });

      await openPreblastSelectForm(navCtx, context as ExtendedContext);
    },
  );

  // Action - new-preblast-button (alternate action ID)
  app.action(
    ACTIONS.NEW_PREBLAST_BUTTON,
    async ({ ack, body, client, context }: TypedActionArgs) => {
      await ack();

      logger.info("New preblast button (alt) clicked");

      const navCtx = createNavContext({
        client,
        body,
        context,
      });

      await openPreblastSelectForm(navCtx, context as ExtendedContext);
    },
  );

  // Handle preblast selection actions (buttons and dropdown)
  // Use regex to match both button clicks and dropdown selection
  app.action(
    new RegExp(`^${ACTIONS.EVENT_PREBLAST_FILL_BUTTON}`),
    handlePreblastSelect,
  );

  // Handle events without Q dropdown selection
  app.action(ACTIONS.EVENT_PREBLAST_NOQ_SELECT, handlePreblastSelect);

  // Handle "New Unscheduled Event" button
  app.action(
    ACTIONS.EVENT_PREBLAST_NEW_BUTTON,
    async (args: TypedActionArgs) => {
      await args.ack();
      logger.info("New unscheduled event preblast requested");
      // TODO: Implement unscheduled event preblast form
    },
  );

  // View submissions - preblast form
  app.view(ACTIONS.EVENT_PREBLAST_CALLBACK_ID, async (args: TypedViewArgs) => {
    await handlePreblastFormSubmit(args);
  });

  app.view(
    ACTIONS.EVENT_PREBLAST_POST_CALLBACK_ID,
    async (args: TypedViewArgs) => {
      await handlePreblastFormSubmit(args);
    },
  );

  // Action handlers - preblast buttons (Take Q, Remove Q, HC, Un-HC, Edit)
  app.action(ACTIONS.EVENT_PREBLAST_TAKE_Q, handlePreblastAction);
  app.action(ACTIONS.EVENT_PREBLAST_REMOVE_Q, handlePreblastAction);
  app.action(ACTIONS.EVENT_PREBLAST_HC, handlePreblastAction);
  app.action(ACTIONS.EVENT_PREBLAST_UN_HC, handlePreblastAction);
  app.action(ACTIONS.EVENT_PREBLAST_EDIT, handlePreblastAction);
}

export { buildPreblastSelectModal } from "./select-form";
export { buildPreblastEditModal } from "./edit-form";
export type { PreblastSelectMetadata } from "./types";
export type { PreblastEditMetadata, PreblastInfo } from "./edit-form-types";

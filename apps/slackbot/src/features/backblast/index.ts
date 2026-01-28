/**
 * Backblast Feature
 *
 * Handles backblast creation workflows:
 * - /backblast command
 * - backblast_shortcut global shortcut
 * - "New Backblast" button actions
 *
 * Entry points all route to the backblast selection form,
 * which shows the user's past Q assignments and events without Q.
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
} from "../../types/bolt-types";
import { buildBackblastSelectModal } from "./select-form";

/**
 * Open the backblast selection form.
 * Fetches user's past Qs and events without Q, builds the selection modal.
 */
async function openBackblastSelectForm(
  navCtx: NavigationContext,
  context: ExtendedContext,
): Promise<void> {
  const userId = context.slackUser?.userId;
  const regionOrgId = context.orgId;

  if (!userId || !regionOrgId) {
    logger.warn("Cannot open backblast form: missing userId or regionOrgId", {
      userId,
      regionOrgId,
    });
    // Still show the modal but with empty state
    await navigateToView(
      navCtx,
      (metadata: NavigationMetadata): ModalView =>
        buildBackblastSelectModal([], [], metadata),
      { showLoading: true, loadingTitle: "Loading Backblasts..." },
    );
    return;
  }

  await navigateToView(
    navCtx,
    async (metadata: NavigationMetadata): Promise<ModalView> => {
      try {
        // Fetch both past Qs and events without Q in parallel
        const [pastQsResponse, noQResponse] = await Promise.all([
          api.eventInstance.getPastQs({
            userId,
            regionOrgId,
            notPostedOnly: true,
          }),
          api.eventInstance.getEventsWithoutQ({
            regionOrgId,
            notPostedOnly: true,
            limit: 20,
          }),
        ]);
        return buildBackblastSelectModal(
          pastQsResponse.eventInstances,
          noQResponse.eventInstances,
          metadata,
        );
      } catch (error) {
        logger.error("Failed to fetch backblast data", error);
        // Return empty state on error
        return buildBackblastSelectModal([], [], metadata);
      }
    },
    { showLoading: true, loadingTitle: "Loading Backblasts..." },
  );
}

/**
 * Handle selection from the backblast select form.
 * Routes to the backblast edit form for the selected event.
 */
async function handleBackblastSelect(args: TypedActionArgs): Promise<void> {
  const { ack, action } = args;
  await ack();

  // Extract the action_id to determine what was selected
  const actionWithId = action as {
    action_id?: string;
    value?: string;
    selected_option?: { value: string };
  };
  const actionId = actionWithId.action_id ?? "";

  let eventInstanceId: number | undefined;

  // Check if this is a quick-select button (action_id starts with BACKBLAST_FILL_BUTTON)
  if (actionId.startsWith(ACTIONS.BACKBLAST_FILL_BUTTON as string)) {
    // For buttons, the value contains the event instance ID
    eventInstanceId = parseInt(actionWithId.value ?? "0", 10);
  }

  // Check if this is the static_select dropdown for past Qs
  if (actionId === ACTIONS.BACKBLAST_FILL_SELECT) {
    eventInstanceId = parseInt(actionWithId.selected_option?.value ?? "0", 10);
  }

  // Check if this is the static_select dropdown for events without Q
  if (actionId === ACTIONS.BACKBLAST_NOQ_SELECT) {
    eventInstanceId = parseInt(actionWithId.selected_option?.value ?? "0", 10);
    logger.info(
      "Backblast selected for event without Q (user will be assigned as Q)",
      {
        eventInstanceId,
      },
    );
    // TODO: Assign user as Q for this event when opening the form
  }

  if (eventInstanceId) {
    logger.info("Backblast selected", { eventInstanceId });
    // TODO: Route to backblast edit form
    // For now, just log - will implement in next phase
    logger.info("Would open backblast form for event", { eventInstanceId });
  }
}

/**
 * Register backblast feature handlers with the Bolt app
 */
export function registerBackblastFeature(app: App): void {
  // Slash command - /backblast
  app.command(
    "/backblast",
    async ({ command, ack, client, context }: TypedCommandArgs) => {
      await ack();

      logger.info("Backblast command received", {
        user: command.user_id,
        team: command.team_id,
      });

      const navCtx = createNavContext({
        client,
        body: { trigger_id: command.trigger_id } as TypedCommandArgs["body"],
        context,
      });

      await openBackblastSelectForm(navCtx, context as ExtendedContext);
    },
  );

  // Global shortcut - backblast_shortcut
  app.shortcut(
    ACTIONS.BACKBLAST_SHORTCUT,
    async ({ ack, shortcut, client, context }) => {
      await ack();

      logger.info("Backblast shortcut triggered", {
        user: shortcut.user.id,
      });

      const navCtx = createNavContext({
        client,
        body: shortcut,
        context,
      });

      await openBackblastSelectForm(navCtx, context as ExtendedContext);
    },
  );

  // Action - new-backblast button (from help menu, backblast posts, etc.)
  app.action(
    ACTIONS.BACKBLAST_NEW_BUTTON,
    async ({ ack, body, client, context }: TypedActionArgs) => {
      await ack();

      logger.info("New backblast button clicked");

      const navCtx = createNavContext({
        client,
        body,
        context,
      });

      await openBackblastSelectForm(navCtx, context as ExtendedContext);
    },
  );

  // Handle backblast selection actions (buttons and dropdown for past Qs)
  // Use regex to match both button clicks and dropdown selection
  app.action(
    new RegExp(`^${ACTIONS.BACKBLAST_FILL_BUTTON}`),
    handleBackblastSelect,
  );

  // Handle dropdown selection for past Qs
  app.action(ACTIONS.BACKBLAST_FILL_SELECT, handleBackblastSelect);

  // Handle dropdown selection for events without Q
  app.action(ACTIONS.BACKBLAST_NOQ_SELECT, handleBackblastSelect);

  // Handle "New Unscheduled Event" button
  app.action(
    ACTIONS.BACKBLAST_NEW_BLANK_BUTTON,
    async (args: TypedActionArgs) => {
      await args.ack();
      logger.info("New unscheduled event backblast requested");
      // TODO: Implement unscheduled event backblast form
    },
  );
}

export { buildBackblastSelectModal } from "./select-form";
export type { BackblastSelectMetadata } from "./types";

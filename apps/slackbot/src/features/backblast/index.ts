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
  TypedViewArgs,
} from "../../types/bolt-types";
import { buildBackblastSelectModal } from "./select-form";
import { buildBackblastInfo, buildBackblastEditModal } from "./edit-form";
import {
  handleBackblastFormSubmit,
  handleBackblastEditButton,
} from "./edit-form-handlers";

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
  }

  if (eventInstanceId) {
    logger.info("Backblast selected", { eventInstanceId });

    // Capture the eventInstanceId for use in callback (TypeScript narrowing)
    const selectedEventId = eventInstanceId;

    // Route to backblast edit form
    const extContext = args.context as ExtendedContext;
    const currentUserId = extContext.slackUser?.userId;
    const teamId = extContext.teamId ?? "";
    const regionOrgId = extContext.orgId ?? 0;
    const orgSettings = extContext.orgSettings ?? null;
    const slackUserId = (args.body as { user?: { id: string } }).user?.id ?? "";

    // For events without Q, assign the user as Q first
    if (actionId === ACTIONS.BACKBLAST_NOQ_SELECT && currentUserId) {
      try {
        await api.attendance.takeQ({
          eventInstanceId: selectedEventId,
          userId: currentUserId,
        });
        logger.info("Assigned user as Q for event", {
          eventInstanceId: selectedEventId,
          userId: currentUserId,
        });
      } catch (error) {
        logger.error("Failed to assign Q", {
          eventInstanceId: selectedEventId,
          error,
        });
      }
    }

    // Navigate to the backblast edit form
    const navCtx = createNavContext(args);

    await navigateToView(
      navCtx,
      async (metadata: NavigationMetadata): Promise<ModalView> => {
        const backblastInfo = await buildBackblastInfo(
          selectedEventId,
          currentUserId ?? null,
          teamId,
        );

        return buildBackblastEditModal(
          backblastInfo,
          metadata,
          orgSettings,
          regionOrgId,
          true, // isEdit — always open the editable form from the select list
          slackUserId,
          backblastInfo?.eventRecord.backblastTs?.toString() ?? undefined,
        );
      },
      { showLoading: true, loadingTitle: "Loading Backblast..." },
    );
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

      const extContext = args.context as ExtendedContext;
      const regionOrgId = extContext.orgId ?? 0;
      const orgSettings = extContext.orgSettings ?? null;
      const slackUserId =
        (args.body as { user?: { id: string } }).user?.id ?? "";

      // Navigate to the backblast edit form with no event (unscheduled)
      const navCtx = createNavContext(args);

      await navigateToView(
        navCtx,
        async (metadata: NavigationMetadata): Promise<ModalView> => {
          return buildBackblastEditModal(
            null, // No backblast info for unscheduled
            metadata,
            orgSettings,
            regionOrgId,
            false, // isEdit
            slackUserId,
          );
        },
        { showLoading: true, loadingTitle: "Loading Backblast..." },
      );
    },
  );

  // Handle backblast from preblast message button
  app.action(
    ACTIONS.MSG_EVENT_BACKBLAST_BUTTON,
    async (args: TypedActionArgs) => {
      await args.ack();

      const actionWithValue = args.action as { value?: string };
      const eventInstanceId = actionWithValue.value
        ? parseInt(actionWithValue.value, 10)
        : undefined;

      if (!eventInstanceId) {
        logger.error("No event instance ID for backblast from preblast");
        return;
      }

      logger.info("Backblast from preblast button clicked", {
        eventInstanceId,
      });

      const extContext = args.context as ExtendedContext;
      const currentUserId = extContext.slackUser?.userId;
      const teamId = extContext.teamId ?? "";
      const regionOrgId = extContext.orgId ?? 0;
      const orgSettings = extContext.orgSettings ?? null;
      const slackUserId =
        (args.body as { user?: { id: string } }).user?.id ?? "";

      const navCtx = createNavContext(args);

      await navigateToView(
        navCtx,
        async (metadata: NavigationMetadata): Promise<ModalView> => {
          const backblastInfo = await buildBackblastInfo(
            eventInstanceId,
            currentUserId ?? null,
            teamId,
          );

          return buildBackblastEditModal(
            backblastInfo,
            metadata,
            orgSettings,
            regionOrgId,
            false, // isEdit
            slackUserId,
          );
        },
        { showLoading: true, loadingTitle: "Loading Backblast..." },
      );
    },
  );

  // Handle backblast edit button click
  app.action(ACTIONS.BACKBLAST_EDIT_BUTTON, handleBackblastEditButton);

  // Handle backblast form submissions
  app.view(ACTIONS.BACKBLAST_CALLBACK_ID, (args: TypedViewArgs) =>
    handleBackblastFormSubmit(args),
  );
  app.view(ACTIONS.BACKBLAST_EDIT_CALLBACK_ID, (args: TypedViewArgs) =>
    handleBackblastFormSubmit(args),
  );
}

export { buildBackblastSelectModal } from "./select-form";
export { buildBackblastEditModal, buildBackblastInfo } from "./edit-form";
export type { BackblastSelectMetadata } from "./types";
export type {
  BackblastEditMetadata,
  BackblastInfo,
  BackblastFormValues,
} from "./edit-form-types";

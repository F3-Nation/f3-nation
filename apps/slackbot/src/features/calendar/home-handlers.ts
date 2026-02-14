/**
 * Calendar Home Action Handlers
 *
 * Handles user interactions in the calendar home view:
 * - Filter changes (AO, event type, date, options)
 * - Event overflow menu actions (Take Q, Edit Preblast, etc.)
 */

import type { ModalView } from "@slack/types";

import { ATTENDANCE_TYPES } from "../../constants/attendance-types";
import { api } from "../../lib/api-client";
import { logger } from "../../lib/logger";
import { createNavContext, navigateToView } from "../../lib/view-navigation";
import type {
  ExtendedContext,
  NavigationMetadata,
  TypedActionArgs,
} from "../../types/bolt-types";
import type {
  CalendarHomeMetadata,
  CalendarHomeEventAction,
} from "./home-types";
import type { CalendarHomeBuildOptions } from "./home";
import { buildCalendarHomeModal, extractFiltersFromValues } from "./home";
import { buildPreblastEditModal } from "../preblast/edit-form";
import { buildAssignQModal } from "./assign-q";
import {
  buildBackblastInfo,
  buildBackblastEditModal,
} from "../backblast/edit-form";

/**
 * Parse the private metadata from the modal view
 */
function parseCalendarMetadata(privateMetadata: string | undefined): {
  navMetadata: NavigationMetadata;
  calendarHome: CalendarHomeMetadata;
} {
  if (!privateMetadata) {
    return {
      navMetadata: { _navDepth: 0 },
      calendarHome: {},
    };
  }

  try {
    const parsed = JSON.parse(privateMetadata) as {
      _navDepth?: number;
      _parentViewId?: string;
      calendarHome?: CalendarHomeMetadata;
    };
    return {
      navMetadata: {
        _navDepth: parsed._navDepth ?? 0,
        _parentViewId: parsed._parentViewId,
      },
      calendarHome: parsed.calendarHome ?? {},
    };
  } catch {
    return {
      navMetadata: { _navDepth: 0 },
      calendarHome: {},
    };
  }
}

/**
 * Handle filter change actions.
 * Rebuilds the calendar home view with updated filters.
 */
export async function handleFilterChange(args: TypedActionArgs): Promise<void> {
  const { ack, body, client, context } = args;
  await ack();

  const extContext = context as ExtendedContext;
  const userId = extContext.slackUser?.userId;
  const regionOrgId = extContext.orgId;

  if (!userId || !regionOrgId) {
    logger.warn("Cannot refresh calendar: missing userId or regionOrgId");
    return;
  }

  // Get view from body - block_actions have view property
  const bodyWithView = body as {
    view?: {
      private_metadata?: string;
      state?: { values?: Record<string, Record<string, unknown>> };
    };
  };
  const view = bodyWithView.view;

  // Parse existing metadata
  const { navMetadata: _navMetadata, calendarHome } = parseCalendarMetadata(
    view?.private_metadata,
  );

  // Extract new filter values from the view state
  const newFilters = extractFiltersFromValues(view?.state?.values ?? {});

  // Merge with existing metadata
  const buildOptions: CalendarHomeBuildOptions = {
    regionOrgId,
    userId,
    userIsAdmin: calendarHome.userIsAdmin ?? false,
    filters: newFilters,
  };

  const navCtx = createNavContext({ client, body, context });

  try {
    await navigateToView(
      navCtx,
      async (metadata: NavigationMetadata): Promise<ModalView> => {
        return buildCalendarHomeModal(buildOptions, metadata);
      },
      { forceUpdate: true },
    );
  } catch (error) {
    logger.error("Failed to refresh calendar home", error);
  }
}

/**
 * Handle event overflow menu selection.
 * Routes to appropriate handler based on selected action.
 */
export async function handleEventAction(args: TypedActionArgs): Promise<void> {
  const { ack, body, client, context, action } = args;
  await ack();

  const extContext = context as ExtendedContext;
  const userId = extContext.slackUser?.userId;
  const regionOrgId = extContext.orgId;
  const teamId = extContext.teamId;

  if (!userId || !regionOrgId) {
    logger.warn("Cannot handle event action: missing userId or regionOrgId");
    return;
  }

  // Extract event ID from action_id (format: "calendar-home-event_123")
  const actionWithId = action as {
    action_id?: string;
    selected_option?: { value: string };
  };
  const actionId = actionWithId.action_id ?? "";
  const eventInstanceId = parseInt(actionId.split("_")[1] ?? "0", 10);
  const selectedAction = actionWithId.selected_option?.value as
    | CalendarHomeEventAction
    | undefined;

  if (!eventInstanceId || !selectedAction) {
    logger.warn("Invalid event action", { actionId, selectedAction });
    return;
  }

  logger.info("Calendar home event action", {
    eventInstanceId,
    action: selectedAction,
    userId,
  });

  const navCtx = createNavContext({ client, body, context });

  // Get view from body
  const bodyWithView = body as { view?: { private_metadata?: string } };
  const { calendarHome } = parseCalendarMetadata(
    bodyWithView.view?.private_metadata,
  );

  switch (selectedAction) {
    case "Take Q":
      await handleTakeQ(
        eventInstanceId,
        userId,
        navCtx,
        extContext,
        calendarHome,
      );
      break;

    case "Edit Preblast":
    case "View Preblast":
      await handleOpenPreblast(
        eventInstanceId,
        userId,
        teamId ?? "",
        navCtx,
        extContext,
        selectedAction,
      );
      break;

    case "HC":
      await handleHC(eventInstanceId, userId, navCtx, extContext, calendarHome);
      break;

    case "Un-HC":
      await handleUnHC(
        eventInstanceId,
        userId,
        navCtx,
        extContext,
        calendarHome,
      );
      break;

    case "Assign Q":
      await handleAssignQ(eventInstanceId, navCtx, extContext);
      break;

    case "Edit Backblast":
    case "View Backblast":
      await handleOpenBackblast(
        eventInstanceId,
        navCtx,
        extContext,
        selectedAction,
      );
      break;

    case "Take Myself Off Q":
      try {
        await api.attendance.removeQ({
          eventInstanceId,
          userId,
        });
      } catch (error) {
        logger.error("Failed to take myself off Q", {
          error,
          eventInstanceId,
          userId,
        });
      }
      await refreshCalendarHome(navCtx, extContext, calendarHome);
      break;

    default:
      logger.warn("Unknown event action", { selectedAction });
  }
}

/**
 * Handle "Take Q" action - assigns current user as Q for the event
 */
async function handleTakeQ(
  eventInstanceId: number,
  userId: number,
  navCtx: ReturnType<typeof createNavContext>,
  extContext: ExtendedContext,
  calendarHome: CalendarHomeMetadata,
): Promise<void> {
  try {
    // Add Q attendance for the user
    await api.attendance.takeQ({
      eventInstanceId,
      userId,
    });

    logger.info("User took Q", { eventInstanceId, userId });

    // Refresh the calendar view
    await refreshCalendarHome(navCtx, extContext, calendarHome);
  } catch (error) {
    logger.error("Failed to take Q", { error, eventInstanceId, userId });
  }
}

/**
 * Handle "HC" action - adds user as planned attendee (HC = "I'm coming")
 */
async function handleHC(
  eventInstanceId: number,
  userId: number,
  navCtx: ReturnType<typeof createNavContext>,
  extContext: ExtendedContext,
  calendarHome: CalendarHomeMetadata,
): Promise<void> {
  try {
    // Add planned attendance (PAX type)
    await api.attendance.createPlanned({
      eventInstanceId,
      userId,
      attendanceTypeIds: [ATTENDANCE_TYPES.PAX],
    });

    logger.info("User HC'd", { eventInstanceId, userId });

    // Refresh the calendar view
    await refreshCalendarHome(navCtx, extContext, calendarHome);
  } catch (error) {
    logger.error("Failed to HC", { error, eventInstanceId, userId });
  }
}

/**
 * Handle "Un-HC" action - removes user's planned attendance
 */
async function handleUnHC(
  eventInstanceId: number,
  userId: number,
  navCtx: ReturnType<typeof createNavContext>,
  extContext: ExtendedContext,
  calendarHome: CalendarHomeMetadata,
): Promise<void> {
  try {
    // Remove planned attendance
    await api.attendance.removePlanned({
      eventInstanceId,
      userId,
    });

    logger.info("User un-HC'd", { eventInstanceId, userId });

    // Refresh the calendar view
    await refreshCalendarHome(navCtx, extContext, calendarHome);
  } catch (error) {
    logger.error("Failed to un-HC", { error, eventInstanceId, userId });
  }
}

/**
 * Handle "Assign Q" action - opens the Assign Q modal
 */
async function handleAssignQ(
  eventInstanceId: number,
  navCtx: ReturnType<typeof createNavContext>,
  extContext: ExtendedContext,
): Promise<void> {
  const teamId = extContext.teamId;

  if (!teamId) {
    logger.error("Missing teamId for Assign Q");
    return;
  }

  try {
    await navigateToView(
      navCtx,
      async (navMetadata: NavigationMetadata): Promise<ModalView> => {
        return buildAssignQModal({ eventInstanceId, teamId }, navMetadata);
      },
      { showLoading: true, loadingTitle: "Loading..." },
    );
  } catch (error) {
    logger.error("Failed to open Assign Q modal", { error, eventInstanceId });
  }
}

/**
 * Handle "Edit Preblast" or "View Preblast" action
 */
async function handleOpenPreblast(
  eventInstanceId: number,
  currentUserId: number | null,
  teamId: string,
  navCtx: ReturnType<typeof createNavContext>,
  extContext: ExtendedContext,
  actionValue: "Edit Preblast" | "View Preblast",
): Promise<void> {
  try {
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
          actionValue,
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
  } catch (error) {
    logger.error("Failed to open preblast", { error, eventInstanceId });
  }
}

/**
 * Handle "Edit Backblast" or "View Backblast" action
 */
async function handleOpenBackblast(
  eventInstanceId: number,
  navCtx: ReturnType<typeof createNavContext>,
  extContext: ExtendedContext,
  actionValue: "Edit Backblast" | "View Backblast",
): Promise<void> {
  const teamId = extContext.teamId;
  const currentUserId = extContext.slackUser?.userId;
  const slackUserId = extContext.slackUser?.slackId;
  const regionOrgId = extContext.orgId;

  if (!teamId || !slackUserId || !regionOrgId) {
    logger.error("Missing context for backblast", {
      teamId,
      slackUserId,
      regionOrgId,
    });
    return;
  }

  try {
    await navigateToView(
      navCtx,
      async (navMetadata: NavigationMetadata): Promise<ModalView> => {
        // Build backblast info
        const backblastInfo = await buildBackblastInfo(
          eventInstanceId,
          currentUserId ?? null,
          teamId,
        );

        // Determine if we should show edit form
        // For "Edit Backblast" action, always show edit form
        // For "View Backblast" action, show read-only view
        const isEdit = actionValue === "Edit Backblast";

        const modal = await buildBackblastEditModal(
          backblastInfo,
          navMetadata,
          extContext.orgSettings ?? null,
          regionOrgId,
          isEdit,
          slackUserId,
        );
        return modal;
      },
      { showLoading: true, loadingTitle: "Loading Backblast..." },
    );
  } catch (error) {
    logger.error("Failed to open backblast", { error, eventInstanceId });
  }
}

/**
 * Refresh the calendar home view after an action
 */
async function refreshCalendarHome(
  navCtx: ReturnType<typeof createNavContext>,
  extContext: ExtendedContext,
  calendarHome: CalendarHomeMetadata,
): Promise<void> {
  const userId = extContext.slackUser?.userId;
  const regionOrgId = extContext.orgId;

  if (!userId || !regionOrgId) {
    return;
  }

  const buildOptions: CalendarHomeBuildOptions = {
    regionOrgId,
    userId,
    userIsAdmin: calendarHome.userIsAdmin ?? false,
    filters: calendarHome.filters,
  };

  try {
    await navigateToView(
      navCtx,
      async (metadata: NavigationMetadata): Promise<ModalView> => {
        return buildCalendarHomeModal(buildOptions, metadata);
      },
      { forceUpdate: true },
    );
  } catch (error) {
    logger.error("Failed to refresh calendar home", error);
  }
}

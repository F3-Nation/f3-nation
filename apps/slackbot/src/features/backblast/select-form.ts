/**
 * Backblast Selection Form
 *
 * Builds the modal for selecting which event to create a backblast for.
 * Displays:
 * 1. User's past Q assignments (quick-select buttons + overflow dropdown)
 * 2. Events without Q assigned (dropdown with confirmation)
 * 3. Button to create backblast for unscheduled event
 */

import type { ModalView, View } from "@slack/web-api";
import { ACTIONS } from "../../constants/actions";
import type { NavigationMetadata } from "../../types/bolt-types";
import { stringifyNavMetadata } from "../../types/bolt-types";
import type { PastQEvent, EventWithoutQ } from "../../types/api-types";
import type { BackblastSelectMetadata } from "./types";

/** Maximum number of quick-action buttons to show before overflow */
const MAX_QUICK_BUTTONS = 4;

/**
 * Format a date string (YYYY-MM-DD) for display (shorter format for buttons)
 */
function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${month}/${day}`;
}

/**
 * Format a date string (YYYY-MM-DD) for display (longer format for dropdowns)
 */
function formatDateLong(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toISOString().split("T")[0] ?? dateStr;
}

/**
 * Build a short display label for an event (for buttons)
 */
function buildEventLabelShort(event: PastQEvent | EventWithoutQ): string {
  const date = formatDateShort(event.startDate);
  const location = event.orgName ?? "Unknown AO";
  return `${date} ${location}`;
}

/**
 * Build a longer display label for an event (for dropdowns)
 */
function buildEventLabelLong(event: PastQEvent | EventWithoutQ): string {
  const date = formatDateLong(event.startDate);
  const location = event.orgName ?? "Unknown AO";
  return `${date} ${location}`;
}

/**
 * Build the backblast selection modal view
 */
export function buildBackblastSelectModal(
  pastQs: PastQEvent[],
  eventsWithoutQ: EventWithoutQ[],
  navMetadata: NavigationMetadata,
): ModalView {
  const blocks: View["blocks"] = [];

  // Section 1: User's past Qs
  if (pastQs.length > 0) {
    // Sort by most recent date first (should already be sorted from API)
    const sortedEvents = [...pastQs].sort((a, b) => {
      const dateCompare = b.startDate.localeCompare(a.startDate);
      if (dateCompare !== 0) return dateCompare;
      return (b.startTime ?? "").localeCompare(a.startTime ?? "");
    });

    blocks.push({
      type: "header",
      text: {
        type: "plain_text",
        text: ":point_up: Select From Recent Qs:",
        emoji: true,
      },
    });

    // Quick-select buttons for first N events
    const quickEvents = sortedEvents.slice(0, MAX_QUICK_BUTTONS);
    const buttonElements = quickEvents.map((event) => ({
      type: "button" as const,
      text: {
        type: "plain_text" as const,
        text: buildEventLabelShort(event).slice(0, 75), // Slack button text limit
        emoji: true,
      },
      action_id: `${ACTIONS.BACKBLAST_FILL_BUTTON}_${event.id}`,
      value: String(event.id),
    }));

    blocks.push({
      type: "actions",
      elements: buttonElements,
    });

    // If more than MAX_QUICK_BUTTONS events, show overflow dropdown
    if (sortedEvents.length > MAX_QUICK_BUTTONS) {
      const overflowOptions = sortedEvents.map((event) => ({
        text: {
          type: "plain_text" as const,
          text: buildEventLabelLong(event).slice(0, 75),
          emoji: true,
        },
        value: String(event.id),
      }));

      blocks.push({
        type: "input",
        dispatch_action: true,
        element: {
          type: "static_select",
          placeholder: {
            type: "plain_text",
            text: "Select an event",
            emoji: true,
          },
          options: overflowOptions,
          action_id: ACTIONS.BACKBLAST_FILL_SELECT,
        },
        label: {
          type: "plain_text",
          text: "All past Qs",
          emoji: true,
        },
        hint: {
          type: "plain_text",
          text: "If not listed above",
        },
      });
    }
  } else {
    // No past Qs
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":white_check_mark: No past events for you to send a backblast for!",
      },
    });
  }

  blocks.push({ type: "divider" });

  // Section 2: Events without Q assigned
  if (eventsWithoutQ.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Or, select from a list of recent events with no Q assigned:*",
      },
    });

    const noQOptions = eventsWithoutQ.map((event) => ({
      text: {
        type: "plain_text" as const,
        text: buildEventLabelLong(event).slice(0, 75),
        emoji: true,
      },
      value: String(event.id),
    }));

    blocks.push({
      type: "input",
      dispatch_action: true,
      element: {
        type: "static_select",
        placeholder: {
          type: "plain_text",
          text: "Select an event",
          emoji: true,
        },
        options: noQOptions,
        action_id: ACTIONS.BACKBLAST_NOQ_SELECT,
        confirm: {
          title: {
            type: "plain_text",
            text: "Are you sure?",
          },
          text: {
            type: "mrkdwn",
            text: "You are selecting an event with no assigned Q. Selecting it will assign you as the Q for this event. Do you want to proceed?",
          },
          confirm: {
            type: "plain_text",
            text: "Yes, I'm sure",
          },
          deny: {
            type: "plain_text",
            text: "Whups, never mind",
          },
        },
      },
      label: {
        type: "plain_text",
        text: "Recent unclaimed Qs",
        emoji: true,
      },
    });

    blocks.push({ type: "divider" });
  }

  // Section 3: Unscheduled event button
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "Or, create a backblast for an event *not on the calendar:*",
    },
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "New Unscheduled Event",
          emoji: true,
        },
        action_id: ACTIONS.BACKBLAST_NEW_BLANK_BUTTON,
        style: "danger",
        confirm: {
          title: {
            type: "plain_text",
            text: "Are you sure?",
          },
          text: {
            type: "mrkdwn",
            text: "This option should *ONLY BE USED FOR UNSCHEDULED EVENTS* that are not listed on the calendar. If this is for a normal, scheduled event, please select it from the lists above.",
          },
          confirm: {
            type: "plain_text",
            text: "Yes, I'm sure",
          },
          deny: {
            type: "plain_text",
            text: "Whups, never mind",
          },
        },
      },
    ],
  });

  // Build metadata
  const metadata: BackblastSelectMetadata = {
    _navDepth: navMetadata._navDepth,
  };

  return {
    type: "modal",
    callback_id: ACTIONS.BACKBLAST_SELECT_CALLBACK_ID,
    title: {
      type: "plain_text",
      text: "Select Backblast",
    },
    close: {
      type: "plain_text",
      text: "Close",
    },
    private_metadata: stringifyNavMetadata(metadata),
    blocks,
  };
}

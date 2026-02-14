/**
 * Preblast Selection Form
 *
 * Builds the modal for selecting which event to create a preblast for.
 * Displays:
 * 1. User's upcoming Q assignments (quick-select buttons + overflow dropdown)
 * 2. Link to calendar to sign up as Q
 * 3. Button to create preblast for unscheduled event
 */

import type { ModalView, View } from "@slack/web-api";
import { ACTIONS } from "../../constants/actions";
import type { NavigationMetadata } from "../../types/bolt-types";
import { stringifyNavMetadata } from "../../types/bolt-types";
import type { UpcomingQEvent } from "../../types/api-types";
import type { PreblastSelectMetadata } from "./types";

/** Maximum number of quick-action buttons to show before overflow */
const MAX_QUICK_BUTTONS = 4;

/**
 * Format a date string (YYYY-MM-DD) for display
 */
function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };
  return date.toLocaleDateString("en-US", options);
}

/**
 * Format a time string (HHMM or HH:MM) for display
 */
function formatTimeDisplay(timeStr: string | null): string {
  if (!timeStr) return "";
  // Handle both HHMM and HH:MM formats
  const normalized = timeStr.replace(":", "");
  if (normalized.length < 4) return timeStr;
  const hours = parseInt(normalized.slice(0, 2), 10);
  const minutes = normalized.slice(2, 4);
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes} ${ampm}`;
}

/**
 * Build a display label for an event
 */
function buildEventLabel(event: UpcomingQEvent): string {
  const date = formatDateDisplay(event.startDate);
  const time = formatTimeDisplay(event.startTime);
  const location = event.orgName ?? "Unknown AO";
  return `${date}${time ? ` @ ${time}` : ""} - ${location}`;
}

/**
 * Build the preblast selection modal view
 */
export function buildPreblastSelectModal(
  upcomingQs: UpcomingQEvent[],
  navMetadata: NavigationMetadata,
): ModalView {
  const blocks: View["blocks"] = [];

  // Section 1: User's upcoming Qs
  if (upcomingQs.length > 0) {
    // Sort by soonest date first (should already be sorted from API)
    const sortedEvents = [...upcomingQs].sort((a, b) => {
      const dateCompare = a.startDate.localeCompare(b.startDate);
      if (dateCompare !== 0) return dateCompare;
      return (a.startTime ?? "").localeCompare(b.startTime ?? "");
    });

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":point_up: *Select From Upcoming Qs:*",
      },
    });

    // Quick-select buttons for first N events
    const quickEvents = sortedEvents.slice(0, MAX_QUICK_BUTTONS);
    const buttonElements = quickEvents.map((event) => ({
      type: "button" as const,
      text: {
        type: "plain_text" as const,
        text: buildEventLabel(event).slice(0, 75), // Slack button text limit
        emoji: true,
      },
      action_id: `${ACTIONS.EVENT_PREBLAST_FILL_BUTTON}_${event.id}`,
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
          text: buildEventLabel(event).slice(0, 75),
          emoji: true,
        },
        value: String(event.id),
      }));

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Or select from all your upcoming Qs:",
        },
        accessory: {
          type: "static_select",
          placeholder: {
            type: "plain_text",
            text: "Select an event",
            emoji: true,
          },
          options: overflowOptions,
          action_id: `${ACTIONS.EVENT_PREBLAST_FILL_BUTTON}_select`,
        },
      });
    }
  } else {
    // No upcoming Qs
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":white_check_mark: *Looks like you are caught up!*\nYou don't have any upcoming Q assignments without preblasts.",
      },
    });
  }

  blocks.push({ type: "divider" });

  // Section 2: Calendar button
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "Sign up to Q for an upcoming event from the calendar:",
    },
  });

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: ":calendar: Open Calendar",
          emoji: true,
        },
        action_id: ACTIONS.OPEN_CALENDAR_BUTTON,
      },
    ],
  });

  blocks.push({ type: "divider" });

  // Section 3: Unscheduled event button
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "Or, create a preblast for an event *not on the calendar:*",
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
        action_id: ACTIONS.EVENT_PREBLAST_NEW_BUTTON,
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
  const metadata: PreblastSelectMetadata = {
    _navDepth: navMetadata._navDepth,
  };

  return {
    type: "modal",
    callback_id: ACTIONS.EVENT_PREBLAST_SELECT_CALLBACK_ID,
    title: {
      type: "plain_text",
      text: "Select Preblast",
    },
    close: {
      type: "plain_text",
      text: "Close",
    },
    private_metadata: stringifyNavMetadata(metadata),
    blocks,
  };
}

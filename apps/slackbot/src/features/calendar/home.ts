/**
 * Calendar Home View Builder
 *
 * Builds the calendar home modal showing upcoming events with
 * filters for AO, event type, date, and options like "Open Q only"
 * and "My events only".
 */

import type {
  ModalView,
  PlainTextOption,
  SectionBlock,
  InputBlock,
  ActionsBlock,
  DividerBlock,
  Overflow,
} from "@slack/types";

import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import type { NavigationMetadata } from "../../types/bolt-types";
import type {
  CalendarHomeEvent,
  CalendarHomeFilterState,
  CalendarHomeMetadata,
  CalendarHomeEventAction,
} from "./home-types";

/**
 * Format date for display: "Monday, January 29"
 */
function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * Build event label text with status icons
 */
function buildEventLabel(event: CalendarHomeEvent): string {
  // Build base label: either series name or AO + event types
  let label: string;
  if (
    event.seriesName &&
    event.orgName &&
    !event.seriesName.includes(event.orgName)
  ) {
    label = `${event.seriesName} @ ${event.orgName}`;
  } else if (event.orgName) {
    const eventTypeNames = event.eventTypes.map((t) => t.name).join(" / ");
    label = `${event.orgName}${eventTypeNames ? ` ${eventTypeNames}` : ""}`;
  } else {
    label = event.name;
  }

  // Add time
  if (event.startTime) {
    label += ` @ ${event.startTime}`;
  }

  // Add Q info
  if (event.plannedQs) {
    label += ` / Q: ${event.plannedQs}`;
  } else {
    label += " / Q: Open!";
  }

  // Add status icons
  if (event.userIsQ) {
    label += " :muscle:";
  }
  if (event.userAttending) {
    label += " :white_check_mark:";
  }
  if (event.hasPreblast) {
    label += " :pencil:";
  }

  return label;
}

/**
 * Determine available actions for an event based on user state
 */
function getEventActions(
  event: CalendarHomeEvent,
  userIsAdmin: boolean,
): CalendarHomeEventAction[] {
  const actions: CalendarHomeEventAction[] = [];

  // Determine if user can edit (admin or Q of the event)
  const canEdit = userIsAdmin || event.userIsQ;

  // Q action
  if (!event.plannedQs) {
    actions.push("Take Q");
  }

  // HC actions
  if (event.userAttending) {
    if (event.userIsQ) {
      actions.push("Take Myself Off Q");
    } else {
      actions.push("Un-HC");
    }
  } else {
    actions.push("HC");
  }

  // Admin-only action
  if (userIsAdmin) {
    actions.push("Assign Q");
  }

  // Preblast actions - Edit if admin or Q, otherwise View
  if (canEdit) {
    actions.push("Edit Preblast");
  } else {
    actions.push("View Preblast");
  }

  // Backblast actions - Edit if admin or Q, otherwise View
  if (canEdit) {
    actions.push("Edit Backblast");
  } else {
    actions.push("View Backblast");
  }

  return actions;
}

/**
 * Build the overflow menu options for an event
 */
function buildEventOverflow(
  eventId: number,
  actions: CalendarHomeEventAction[],
): Overflow {
  return {
    type: "overflow",
    action_id: `${ACTIONS.CALENDAR_HOME_EVENT}_${eventId}`,
    options: actions.map((action) => ({
      text: { type: "plain_text" as const, text: action },
      value: action,
    })),
  };
}

/**
 * Build event section block
 */
function buildEventBlock(
  event: CalendarHomeEvent,
  userIsAdmin: boolean,
): SectionBlock {
  const label = buildEventLabel(event);
  const actions = getEventActions(event, userIsAdmin);

  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: label,
    },
    accessory: buildEventOverflow(event.id, actions),
  };
}

/**
 * Build filter input blocks
 */
function buildFilterBlocks(
  aoOptions: PlainTextOption[],
  eventTypeOptions: PlainTextOption[],
  currentFilters: CalendarHomeFilterState,
): (InputBlock | ActionsBlock)[] {
  const blocks: (InputBlock | ActionsBlock)[] = [];

  // AO filter
  blocks.push({
    type: "input",
    block_id: "ao_filter_block",
    dispatch_action: true,
    optional: true,
    label: {
      type: "plain_text",
      text: "Filter AOs",
    },
    element: {
      type: "multi_static_select",
      action_id: ACTIONS.CALENDAR_HOME_AO_FILTER,
      placeholder: {
        type: "plain_text",
        text: "Filter AOs",
      },
      options: aoOptions.length > 0 ? aoOptions : undefined,
      initial_options:
        currentFilters.aoOrgIds && aoOptions.length > 0
          ? aoOptions.filter((o) =>
              currentFilters.aoOrgIds!.includes(parseInt(o.value ?? "0", 10)),
            )
          : undefined,
    },
  });

  // Event type filter
  blocks.push({
    type: "input",
    block_id: "event_type_filter_block",
    dispatch_action: true,
    optional: true,
    label: {
      type: "plain_text",
      text: "Filter Event Types",
    },
    element: {
      type: "multi_static_select",
      action_id: ACTIONS.CALENDAR_HOME_EVENT_TYPE_FILTER,
      placeholder: {
        type: "plain_text",
        text: "Filter Event Types",
      },
      options: eventTypeOptions.length > 0 ? eventTypeOptions : undefined,
      initial_options:
        currentFilters.eventTypeIds && eventTypeOptions.length > 0
          ? eventTypeOptions.filter((o) =>
              currentFilters.eventTypeIds!.includes(
                parseInt(o.value ?? "0", 10),
              ),
            )
          : undefined,
    },
  });

  // Date filter
  blocks.push({
    type: "input",
    block_id: "date_filter_block",
    dispatch_action: true,
    optional: true,
    label: {
      type: "plain_text",
      text: "Start Search Date",
    },
    element: {
      type: "datepicker",
      action_id: ACTIONS.CALENDAR_HOME_DATE_FILTER,
      placeholder: {
        type: "plain_text",
        text: "Start Search Date",
      },
      initial_date: currentFilters.startDate,
    },
  });

  // Checkbox options (Open Q only, My events only)
  const checkboxOptions: PlainTextOption[] = [
    {
      text: { type: "plain_text", text: "Show only open Q slots" },
      value: ACTIONS.CALENDAR_HOME_FILTER_OPEN_Q,
    },
    {
      text: { type: "plain_text", text: "Show only my events" },
      value: ACTIONS.CALENDAR_HOME_FILTER_MY_EVENTS,
    },
  ];

  const selectedCheckboxOptions: PlainTextOption[] = [];
  if (currentFilters.openQOnly) {
    selectedCheckboxOptions.push(checkboxOptions[0]!);
  }
  if (currentFilters.onlyUserEvents) {
    selectedCheckboxOptions.push(checkboxOptions[1]!);
  }

  blocks.push({
    type: "input",
    block_id: "options_filter_block",
    dispatch_action: true,
    optional: true,
    label: {
      type: "plain_text",
      text: "Other options",
    },
    element: {
      type: "checkboxes",
      action_id: ACTIONS.CALENDAR_HOME_Q_FILTER,
      options: checkboxOptions,
      initial_options:
        selectedCheckboxOptions.length > 0
          ? selectedCheckboxOptions
          : undefined,
    },
  });

  return blocks;
}

/**
 * Build the event list blocks grouped by date
 */
function buildEventListBlocks(
  events: CalendarHomeEvent[],
  userIsAdmin: boolean,
): (SectionBlock | DividerBlock)[] {
  const blocks: (SectionBlock | DividerBlock)[] = [];
  let currentDate = "";
  let blockCount = 0;

  for (const event of events) {
    // Limit to 90 blocks (Slack modal limit is 100, reserve some for filters)
    if (blockCount > 90) {
      break;
    }

    // Add date header when date changes
    if (event.startDate !== currentDate) {
      currentDate = event.startDate;
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:calendar: *${formatDateHeader(currentDate)}*`,
        },
      });
      blockCount++;
    }

    // Add event block
    blocks.push(buildEventBlock(event, userIsAdmin));
    blockCount++;
  }

  // Empty state
  if (events.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No events found matching your filters._",
      },
    });
  }

  return blocks;
}

export interface CalendarHomeBuildOptions {
  regionOrgId: number;
  userId: number;
  userIsAdmin: boolean;
  filters?: CalendarHomeFilterState;
}

/**
 * Build the calendar home modal view
 */
export async function buildCalendarHomeModal(
  options: CalendarHomeBuildOptions,
  navMetadata: NavigationMetadata,
): Promise<ModalView> {
  const { regionOrgId, userId, userIsAdmin, filters = {} } = options;

  // Fetch data in parallel
  const [aosResult, eventTypesResult, eventsResult] = await Promise.all([
    api.org.all({
      parentOrgIds: [regionOrgId],
      orgTypes: ["ao"],
      statuses: ["active"],
    }),
    api.eventType.all({
      orgIds: [regionOrgId],
      statuses: ["active"],
    }),
    api.eventInstance.getCalendarHomeSchedule({
      userId,
      regionOrgId,
      aoOrgIds: filters.aoOrgIds,
      startDate: filters.startDate,
      eventTypeIds: filters.eventTypeIds,
      openQOnly: filters.openQOnly,
      onlyUserEvents: filters.onlyUserEvents,
      limit: 100,
    }),
  ]);

  // Build AO options
  const aoOptions: PlainTextOption[] = aosResult.orgs.map((ao) => ({
    text: { type: "plain_text" as const, text: ao.name },
    value: ao.id.toString(),
  }));

  // Build event type options
  const eventTypeOptions: PlainTextOption[] = eventTypesResult.eventTypes.map(
    (et) => ({
      text: { type: "plain_text" as const, text: et.name },
      value: et.id.toString(),
    }),
  );

  // Build blocks
  const blocks: ModalView["blocks"] = [
    {
      type: "divider",
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Upcoming Schedule*",
      },
    },
    ...buildFilterBlocks(aoOptions, eventTypeOptions, filters),
    ...buildEventListBlocks(eventsResult.events, userIsAdmin),
  ];

  // Store metadata for filter persistence
  const calendarMetadata: CalendarHomeMetadata = {
    userIsAdmin,
    filters,
  };

  const privateMetadata = JSON.stringify({
    ...navMetadata,
    calendarHome: calendarMetadata,
  });

  return {
    type: "modal",
    callback_id: ACTIONS.CALENDAR_HOME_CALLBACK_ID,
    private_metadata: privateMetadata,
    title: {
      type: "plain_text",
      text: "Calendar Home",
    },
    close: {
      type: "plain_text",
      text: "Close",
    },
    blocks,
  };
}

/**
 * Extract filter state from form values
 */
export function extractFiltersFromValues(
  values: Record<string, Record<string, unknown>>,
): CalendarHomeFilterState {
  const filters: CalendarHomeFilterState = {};

  // AO filter
  const aoFilter = values.ao_filter_block?.[ACTIONS.CALENDAR_HOME_AO_FILTER] as
    | { selected_options?: { value: string }[] }
    | undefined;
  if (aoFilter?.selected_options?.length) {
    filters.aoOrgIds = aoFilter.selected_options.map((o) =>
      parseInt(o.value, 10),
    );
  }

  // Event type filter
  const eventTypeFilter = values.event_type_filter_block?.[
    ACTIONS.CALENDAR_HOME_EVENT_TYPE_FILTER
  ] as { selected_options?: { value: string }[] } | undefined;
  if (eventTypeFilter?.selected_options?.length) {
    filters.eventTypeIds = eventTypeFilter.selected_options.map((o) =>
      parseInt(o.value, 10),
    );
  }

  // Date filter
  const dateFilter = values.date_filter_block?.[
    ACTIONS.CALENDAR_HOME_DATE_FILTER
  ] as { selected_date?: string } | undefined;
  if (dateFilter?.selected_date) {
    filters.startDate = dateFilter.selected_date;
  }

  // Checkbox options
  const optionsFilter = values.options_filter_block?.[
    ACTIONS.CALENDAR_HOME_Q_FILTER
  ] as { selected_options?: { value: string }[] } | undefined;
  if (optionsFilter?.selected_options) {
    const selectedValues = optionsFilter.selected_options.map((o) => o.value);
    filters.openQOnly = selectedValues.includes(
      ACTIONS.CALENDAR_HOME_FILTER_OPEN_Q,
    );
    filters.onlyUserEvents = selectedValues.includes(
      ACTIONS.CALENDAR_HOME_FILTER_MY_EVENTS,
    );
  }

  return filters;
}

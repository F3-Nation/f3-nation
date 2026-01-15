import type { App, BlockAction } from "@slack/bolt";
import type { ModalView, PlainTextOption, SectionBlock } from "@slack/types";
import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import type { TypedActionArgs, TypedViewArgs } from "../../types/bolt-types";
import { logger } from "../../lib/logger";
import { createNavContext, navigateToView } from "../../lib/view-navigation";

/**
 * Days of week for series recurrence
 */
const DAYS_OF_WEEK = [
  { name: "Monday", value: "monday" },
  { name: "Tuesday", value: "tuesday" },
  { name: "Wednesday", value: "wednesday" },
  { name: "Thursday", value: "thursday" },
  { name: "Friday", value: "friday" },
  { name: "Saturday", value: "saturday" },
  { name: "Sunday", value: "sunday" },
] as const;

/**
 * Frequency options for series
 */
const FREQUENCY_OPTIONS = [
  { name: "Weekly", value: "weekly" },
  { name: "Monthly", value: "monthly" },
] as const;

/**
 * Interval options (every 1, 2, 3, or 4 weeks/months)
 */
const INTERVAL_OPTIONS = [
  { name: "Every", value: "1" },
  { name: "Every other", value: "2" },
  { name: "Every 3rd", value: "3" },
  { name: "Every 4th", value: "4" },
] as const;

/**
 * Series Response type
 */
interface SeriesResponse {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  locationId: number | null;
  startDate: string;
  dayOfWeek: string | null;
  startTime: string | null;
  endTime: string | null;
  highlight: boolean;
  recurrencePattern: string | null;
  recurrenceInterval: number | null;
  indexWithinInterval: number | null;
  meta: Record<string, unknown> | null;
}

interface AOResponse {
  id: number;
  name: string;
  defaultLocationId: number | null;
}

interface LocationResponse {
  id: number;
  name: string;
  addressCity: string | null;
}

interface EventTypeResponse {
  id: number;
  name: string;
}

/**
 * Handle manage series action from the calendar config menu
 */
export async function manageSeries(args: TypedActionArgs) {
  const { ack, body } = args;
  await ack();

  const action = (body as BlockAction).actions?.[0];
  if (!action) return;
  if (action.type !== "overflow" && action.type !== "static_select") return;

  const value = action.selected_option?.value;
  const navCtx = createNavContext(args);

  if (value === "add") {
    await navigateToView(
      navCtx,
      async () => {
        const { aos, locations, eventTypes, eventTags } =
          await fetchFormOptions(args.context.teamId!);
        return buildSeriesAddForm({ aos, locations, eventTypes, eventTags });
      },
      { showLoading: true, loadingTitle: "Loading..." },
    );
  } else if (value === "edit") {
    await buildSeriesListForm(args);
  }
}

/**
 * Fetch form options (AOs, locations, event types, event tags)
 */
async function fetchFormOptions(teamId: string) {
  const region = await api.slack.getRegion(teamId);
  if (!region) return { aos: [], locations: [], eventTypes: [], eventTags: [] };

  const [orgResult, locationResult, eventTypeResult, eventTagResult] =
    await Promise.all([
      api.org.all({ orgTypes: ["ao"], parentOrgIds: [region.org.id] }),
      api.location.all({ regionIds: [region.org.id] }),
      api.eventType.all({ orgIds: [region.org.id], statuses: ["active"] }),
      api.eventTag.all({ orgIds: [region.org.id], statuses: ["active"] }),
    ]);

  return {
    aos: orgResult.orgs as unknown as AOResponse[],
    locations: locationResult.locations as unknown as LocationResponse[],
    eventTypes: eventTypeResult.eventTypes as unknown as EventTypeResponse[],
    eventTags: eventTagResult.eventTags,
  };
}

/**
 * Build series add/edit form
 */
export function buildSeriesAddForm(options: {
  aos: AOResponse[];
  locations: LocationResponse[];
  eventTypes: EventTypeResponse[];
  eventTags: { id: number; name: string }[];
  editSeries?: SeriesResponse;
}): ModalView {
  const { aos, locations, eventTypes, eventTags, editSeries } = options;

  const aoOptions: PlainTextOption[] = aos.map((ao) => ({
    text: { type: "plain_text", text: ao.name },
    value: ao.id.toString(),
  }));

  const locationOptions: PlainTextOption[] = locations.map((loc) => ({
    text: {
      type: "plain_text",
      text: loc.addressCity ? `${loc.name} (${loc.addressCity})` : loc.name,
    },
    value: loc.id.toString(),
  }));

  const eventTypeOptions: PlainTextOption[] = eventTypes.map((et) => ({
    text: { type: "plain_text", text: et.name },
    value: et.id.toString(),
  }));

  const eventTagOptions: PlainTextOption[] = eventTags.map((tag) => ({
    text: { type: "plain_text", text: tag.name },
    value: tag.id.toString(),
  }));

  const frequencyOptions: PlainTextOption[] = FREQUENCY_OPTIONS.map((f) => ({
    text: { type: "plain_text", text: f.name },
    value: f.value,
  }));

  const intervalOptions: PlainTextOption[] = INTERVAL_OPTIONS.map((i) => ({
    text: { type: "plain_text", text: i.name },
    value: i.value,
  }));

  const blocks: ModalView["blocks"] = [];

  // AO select
  if (aoOptions.length > 0) {
    blocks.push({
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_SERIES_AO,
      label: { type: "plain_text", text: "AO" },
      element: {
        type: "static_select",
        action_id: ACTIONS.CALENDAR_ADD_SERIES_AO,
        placeholder: { type: "plain_text", text: "Select an AO" },
        options: aoOptions,
      },
    });
  }

  // Location select
  if (locationOptions.length > 0) {
    blocks.push({
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_SERIES_LOCATION,
      label: { type: "plain_text", text: "Default Location" },
      element: {
        type: "static_select",
        action_id: ACTIONS.CALENDAR_ADD_SERIES_LOCATION,
        placeholder: { type: "plain_text", text: "Select a location" },
        options: locationOptions,
        ...(editSeries?.locationId
          ? {
              initial_option: locationOptions.find(
                (o) => o.value === editSeries.locationId?.toString(),
              ),
            }
          : {}),
      },
    });
  }

  // Event Type select
  if (eventTypeOptions.length > 0) {
    blocks.push({
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_SERIES_TYPE,
      label: { type: "plain_text", text: "Event Type" },
      element: {
        type: "static_select",
        action_id: ACTIONS.CALENDAR_ADD_SERIES_TYPE,
        placeholder: { type: "plain_text", text: "Select an event type" },
        options: eventTypeOptions,
      },
    });
  }

  // Event Tag select (optional)
  if (eventTagOptions.length > 0) {
    blocks.push({
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_SERIES_TAG,
      label: { type: "plain_text", text: "Event Tag (optional)" },
      optional: true,
      element: {
        type: "static_select",
        action_id: ACTIONS.CALENDAR_ADD_SERIES_TAG,
        placeholder: { type: "plain_text", text: "Select an event tag" },
        options: eventTagOptions,
      },
    });
  }

  // Recurrence fields - only show when adding new series
  if (!editSeries) {
    blocks.push(
      {
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_SERIES_START_DATE,
        label: { type: "plain_text", text: "Start Date" },
        element: {
          type: "datepicker",
          action_id: ACTIONS.CALENDAR_ADD_SERIES_START_DATE,
          placeholder: { type: "plain_text", text: "Select a date" },
          initial_date: new Date().toISOString().split("T")[0],
        },
      },
      {
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_SERIES_END_DATE,
        label: { type: "plain_text", text: "End Date (optional)" },
        optional: true,
        hint: {
          type: "plain_text",
          text: "Leave blank for indefinite series",
        },
        element: {
          type: "datepicker",
          action_id: ACTIONS.CALENDAR_ADD_SERIES_END_DATE,
          placeholder: { type: "plain_text", text: "Select a date" },
        },
      },
    );
  }

  // Start/End Time
  blocks.push(
    {
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_SERIES_START_TIME,
      label: { type: "plain_text", text: "Start Time" },
      element: {
        type: "timepicker",
        action_id: ACTIONS.CALENDAR_ADD_SERIES_START_TIME,
        placeholder: { type: "plain_text", text: "Select a time" },
        initial_time: editSeries?.startTime
          ? formatTimeForSlack(editSeries.startTime)
          : "05:30",
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_SERIES_END_TIME,
      label: { type: "plain_text", text: "End Time (optional)" },
      optional: true,
      hint: {
        type: "plain_text",
        text: "Defaults to 1 hour after start time",
      },
      element: {
        type: "timepicker",
        action_id: ACTIONS.CALENDAR_ADD_SERIES_END_TIME,
        placeholder: { type: "plain_text", text: "Select a time" },
        ...(editSeries?.endTime
          ? { initial_time: formatTimeForSlack(editSeries.endTime) }
          : {}),
      },
    },
  );

  // Day of Week - only for new series
  if (!editSeries) {
    const dowOptions = DAYS_OF_WEEK.map((d) => ({
      text: { type: "plain_text" as const, text: d.name },
      value: d.value,
    }));

    blocks.push({
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_SERIES_DOW,
      label: { type: "plain_text", text: "Day(s) of Week" },
      element: {
        type: "checkboxes",
        action_id: ACTIONS.CALENDAR_ADD_SERIES_DOW,
        options: dowOptions,
      },
    });

    // Frequency
    blocks.push({
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_SERIES_FREQUENCY,
      label: { type: "plain_text", text: "Frequency" },
      element: {
        type: "static_select",
        action_id: ACTIONS.CALENDAR_ADD_SERIES_FREQUENCY,
        placeholder: { type: "plain_text", text: "Select frequency" },
        options: frequencyOptions,
        initial_option: frequencyOptions[0],
      },
    });

    // Interval
    blocks.push({
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_SERIES_INTERVAL,
      label: { type: "plain_text", text: "Interval" },
      element: {
        type: "static_select",
        action_id: ACTIONS.CALENDAR_ADD_SERIES_INTERVAL,
        placeholder: { type: "plain_text", text: "Select interval" },
        options: intervalOptions,
        initial_option: intervalOptions[0],
      },
    });

    // Index within interval (for monthly)
    blocks.push({
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_SERIES_INDEX,
      label: { type: "plain_text", text: "Week of Month" },
      hint: {
        type: "plain_text",
        text: "Only relevant for monthly series",
      },
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.CALENDAR_ADD_SERIES_INDEX,
        placeholder: { type: "plain_text", text: "1, 2, 3, 4, or 5" },
        initial_value: "1",
      },
    });
  }

  // Series Name
  blocks.push({
    type: "input",
    block_id: ACTIONS.CALENDAR_ADD_SERIES_NAME,
    label: { type: "plain_text", text: "Series Name (optional)" },
    optional: true,
    hint: {
      type: "plain_text",
      text: "Defaults to AO name + Event Type",
    },
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.CALENDAR_ADD_SERIES_NAME,
      placeholder: { type: "plain_text", text: "Enter series name" },
      ...(editSeries?.name ? { initial_value: editSeries.name } : {}),
    },
  });

  // Description
  blocks.push({
    type: "input",
    block_id: ACTIONS.CALENDAR_ADD_SERIES_DESCRIPTION,
    label: { type: "plain_text", text: "Description (optional)" },
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.CALENDAR_ADD_SERIES_DESCRIPTION,
      placeholder: { type: "plain_text", text: "Enter description" },
      multiline: true,
      ...(editSeries?.description
        ? { initial_value: editSeries.description }
        : {}),
    },
  });

  // Options (private, no auto-preblasts, highlight)
  const optionsList = [
    {
      text: { type: "plain_text" as const, text: "Make event private" },
      value: "private",
      description: {
        type: "plain_text" as const,
        text: "Hides from Maps and PAX Vault",
      },
    },
    {
      text: { type: "plain_text" as const, text: "Do not send auto-preblasts" },
      value: "no_auto_preblasts",
      description: {
        type: "plain_text" as const,
        text: "Opts out of automated preblasts",
      },
    },
    {
      text: { type: "plain_text" as const, text: "Highlight on Special List" },
      value: "highlight",
      description: {
        type: "plain_text" as const,
        text: "For convergences, 2nd F events, etc.",
      },
    },
  ];

  const initialOptions: typeof optionsList = [];
  if (editSeries?.meta?.do_not_send_auto_preblasts) {
    const opt = optionsList[1];
    if (opt) initialOptions.push(opt);
  }
  if (editSeries?.highlight) {
    const opt = optionsList[2];
    if (opt) initialOptions.push(opt);
  }

  blocks.push({
    type: "input",
    block_id: ACTIONS.CALENDAR_ADD_SERIES_OPTIONS,
    label: { type: "plain_text", text: "Options" },
    optional: true,
    element: {
      type: "checkboxes",
      action_id: ACTIONS.CALENDAR_ADD_SERIES_OPTIONS,
      options: optionsList,
      ...(initialOptions.length > 0 ? { initial_options: initialOptions } : {}),
    },
  });

  return {
    type: "modal",
    callback_id: ACTIONS.ADD_SERIES_CALLBACK_ID,
    title: {
      type: "plain_text",
      text: editSeries ? "Edit Series" : "Add Series",
    },
    blocks,
    private_metadata: editSeries
      ? JSON.stringify({ series_id: editSeries.id })
      : undefined,
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
  };
}

/**
 * Format time from HHmm to HH:mm for Slack timepicker
 */
function formatTimeForSlack(time: string): string {
  if (time.includes(":")) return time;
  return `${time.slice(0, 2)}:${time.slice(2, 4)}`;
}

/**
 * Format time from HH:mm to HHmm for API
 */
function formatTimeForApi(time: string): string {
  return time.replace(":", "");
}

/**
 * Handle series add/edit submission
 */
export async function handleSeriesAdd({ ack, view, context }: TypedViewArgs) {
  await ack();

  const values = view.state.values;
  const metadata = view.private_metadata
    ? (JSON.parse(view.private_metadata) as Record<string, unknown>)
    : {};

  // Get the region
  const region = await api.slack.getRegion(context.teamId!);
  if (!region) {
    logger.error(`Could not find region for team ${context.teamId}`);
    return;
  }

  // Extract form values
  const aoId = parseInt(
    values[ACTIONS.CALENDAR_ADD_SERIES_AO]?.[ACTIONS.CALENDAR_ADD_SERIES_AO]
      ?.selected_option?.value ?? "0",
  );
  const locationId = parseInt(
    values[ACTIONS.CALENDAR_ADD_SERIES_LOCATION]?.[
      ACTIONS.CALENDAR_ADD_SERIES_LOCATION
    ]?.selected_option?.value ?? "0",
  );
  const eventTypeId = parseInt(
    values[ACTIONS.CALENDAR_ADD_SERIES_TYPE]?.[ACTIONS.CALENDAR_ADD_SERIES_TYPE]
      ?.selected_option?.value ?? "0",
  );
  const name =
    values[ACTIONS.CALENDAR_ADD_SERIES_NAME]?.[ACTIONS.CALENDAR_ADD_SERIES_NAME]
      ?.value ?? undefined;
  const description =
    values[ACTIONS.CALENDAR_ADD_SERIES_DESCRIPTION]?.[
      ACTIONS.CALENDAR_ADD_SERIES_DESCRIPTION
    ]?.value ?? undefined;

  const startTime =
    values[ACTIONS.CALENDAR_ADD_SERIES_START_TIME]?.[
      ACTIONS.CALENDAR_ADD_SERIES_START_TIME
    ]?.selected_time;
  const endTime =
    values[ACTIONS.CALENDAR_ADD_SERIES_END_TIME]?.[
      ACTIONS.CALENDAR_ADD_SERIES_END_TIME
    ]?.selected_time;

  // Options
  const selectedOptions =
    values[ACTIONS.CALENDAR_ADD_SERIES_OPTIONS]?.[
      ACTIONS.CALENDAR_ADD_SERIES_OPTIONS
    ]?.selected_options?.map((o) => o.value) ?? [];
  const isPrivate = selectedOptions.includes("private");
  const noAutoPreblasts = selectedOptions.includes("no_auto_preblasts");
  const highlight = selectedOptions.includes("highlight");

  const meta: Record<string, unknown> = {};
  if (noAutoPreblasts) {
    meta.do_not_send_auto_preblasts = true;
  }

  // For new series, get recurrence fields
  const isEditing = !!metadata.series_id;
  if (!isEditing) {
    const startDate =
      values[ACTIONS.CALENDAR_ADD_SERIES_START_DATE]?.[
        ACTIONS.CALENDAR_ADD_SERIES_START_DATE
      ]?.selected_date;
    const endDate =
      values[ACTIONS.CALENDAR_ADD_SERIES_END_DATE]?.[
        ACTIONS.CALENDAR_ADD_SERIES_END_DATE
      ]?.selected_date ?? null;
    const daysOfWeek =
      values[ACTIONS.CALENDAR_ADD_SERIES_DOW]?.[ACTIONS.CALENDAR_ADD_SERIES_DOW]
        ?.selected_options ?? [];
    const frequency =
      values[ACTIONS.CALENDAR_ADD_SERIES_FREQUENCY]?.[
        ACTIONS.CALENDAR_ADD_SERIES_FREQUENCY
      ]?.selected_option?.value ?? "weekly";
    const interval = parseInt(
      values[ACTIONS.CALENDAR_ADD_SERIES_INTERVAL]?.[
        ACTIONS.CALENDAR_ADD_SERIES_INTERVAL
      ]?.selected_option?.value ?? "1",
    );
    const indexWithinInterval = parseInt(
      values[ACTIONS.CALENDAR_ADD_SERIES_INDEX]?.[
        ACTIONS.CALENDAR_ADD_SERIES_INDEX
      ]?.value ?? "1",
    );

    // Create a series for each selected day of week
    for (const dow of daysOfWeek) {
      const input = {
        aoId: aoId || undefined,
        regionId: region.org.id,
        locationId: locationId || undefined,
        eventTypeIds: eventTypeId ? [eventTypeId] : [],
        name,
        description,
        startDate: startDate ?? undefined,
        endDate: endDate ?? undefined,
        startTime: startTime ? formatTimeForApi(startTime) : undefined,
        endTime: endTime ? formatTimeForApi(endTime) : undefined,
        dayOfWeek: dow.value,
        recurrencePattern: frequency,
        recurrenceInterval: interval,
        indexWithinInterval,
        isActive: true,
        isPrivate,
        highlight,
        meta: Object.keys(meta).length > 0 ? meta : undefined,
      };

      try {
        await api.series.crupdate(input);
      } catch (error) {
        logger.error("Failed to create series", error);
      }
    }
  } else {
    // Editing existing series
    const input = {
      id: metadata.series_id as number,
      aoId: aoId || undefined,
      regionId: region.org.id,
      locationId: locationId || undefined,
      eventTypeIds: eventTypeId ? [eventTypeId] : [],
      name,
      description,
      startTime: startTime ? formatTimeForApi(startTime) : undefined,
      endTime: endTime ? formatTimeForApi(endTime) : undefined,
      isPrivate,
      highlight,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
    };

    try {
      await api.series.crupdate(input);
    } catch (error) {
      logger.error("Failed to update series", error);
    }
  }
}

/**
 * Build series list form for edit/delete
 */
export async function buildSeriesListForm(args: TypedActionArgs) {
  const navCtx = createNavContext(args);

  await navigateToView(
    navCtx,
    async () => {
      const region = await api.slack.getRegion(args.context.teamId!);
      if (!region) {
        return {
          type: "modal",
          title: { type: "plain_text", text: "Error" },
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "Region not found" },
            },
          ],
        };
      }

      const { events: series } = await api.series.all({
        regionIds: [region.org.id],
        statuses: ["active"],
      });

      const blocks: (
        | SectionBlock
        | { type: "context"; elements: { type: "mrkdwn"; text: string }[] }
      )[] = [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "_Editing or deleting a series affects only the series record. Event instances are managed separately._",
            },
          ],
        },
      ];

      for (const s of series.slice(0, 40)) {
        const dow = s.dayOfWeek
          ? s.dayOfWeek.charAt(0).toUpperCase() + s.dayOfWeek.slice(1)
          : "N/A";
        const time = s.startTime ? formatTimeForSlack(s.startTime) : "N/A";
        const label = `${s.name} (${dow} @ ${time})`.slice(0, 50);

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${label}*`,
          },
          accessory: {
            type: "static_select",
            action_id: `${ACTIONS.SERIES_EDIT_DELETE}_${s.id}`,
            placeholder: { type: "plain_text", text: "Edit or Delete" },
            options: [
              { text: { type: "plain_text", text: "Edit" }, value: "edit" },
              { text: { type: "plain_text", text: "Delete" }, value: "delete" },
            ],
            confirm: {
              title: { type: "plain_text", text: "Are you sure?" },
              text: {
                type: "plain_text",
                text: "Are you sure you want to edit / delete this series?",
              },
              confirm: { type: "plain_text", text: "Yes, I'm sure" },
              deny: { type: "plain_text", text: "Whups, never mind" },
            },
          },
        });
      }

      return {
        type: "modal",
        callback_id: ACTIONS.EDIT_DELETE_SERIES_CALLBACK_ID,
        title: { type: "plain_text", text: "Manage Series" },
        blocks:
          series.length > 0
            ? blocks
            : [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: "No active series found for this region.",
                  },
                },
              ],
        close: { type: "plain_text", text: "Back" },
      };
    },
    { showLoading: true, loadingTitle: "Loading Series" },
  );
}

/**
 * Handle series edit/delete action
 */
export async function handleSeriesEditDelete(args: TypedActionArgs) {
  const { ack, body } = args;
  await ack();

  const action = (body as BlockAction).actions[0];
  if (!action || action.type !== "static_select") return;

  const seriesIdStr = action.action_id.split("_").pop();
  if (!seriesIdStr) return;
  const seriesId = parseInt(seriesIdStr);
  const value = action.selected_option?.value;
  const navCtx = createNavContext(args);

  if (value === "edit") {
    await navigateToView(
      navCtx,
      async () => {
        const { event: series } = await api.series.byId({ id: seriesId });
        if (!series) {
          return {
            type: "modal",
            title: { type: "plain_text", text: "Error" },
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "Series not found" },
              },
            ],
          };
        }

        const { aos, locations, eventTypes, eventTags } =
          await fetchFormOptions(args.context.teamId!);
        return buildSeriesAddForm({
          aos,
          locations,
          eventTypes,
          eventTags,
          editSeries: series,
        });
      },
      { showLoading: true, loadingTitle: "Loading Series" },
    );
  } else if (value === "delete") {
    try {
      await api.series.delete(seriesId);
    } catch (error) {
      logger.error("Failed to delete series", error);
    }
  }
}

/**
 * Register Series handlers
 */
export function registerSeriesHandlers(app: App) {
  // View submission for add/edit
  app.view(ACTIONS.ADD_SERIES_CALLBACK_ID, handleSeriesAdd);

  // Regex for the dynamic action ID (edit/delete selection)
  app.action(
    new RegExp(`^${ACTIONS.SERIES_EDIT_DELETE}_\\d+$`),
    handleSeriesEditDelete,
  );
}

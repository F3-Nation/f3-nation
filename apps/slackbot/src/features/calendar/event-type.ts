import type { App, BlockAction } from "@slack/bolt";
import type { ModalView, PlainTextOption, SectionBlock } from "@slack/types";
import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import type { TypedActionArgs, TypedViewArgs } from "../../types/bolt-types";
import { logger } from "../../lib/logger";
import { createNavContext, navigateToView } from "../../lib/view-navigation";

/**
 * Event categories from the database - matches Event_Category enum
 */
const EVENT_CATEGORIES = [
  { name: "First F", value: "first_f" },
  { name: "Second F", value: "second_f" },
  { name: "Third F", value: "third_f" },
] as const;

/**
 * Event Type Response type
 */
interface EventTypeResponse {
  id: number;
  name: string;
  description: string | null;
  eventCategory: string;
  acronym: string | null;
  specificOrgId: number | null;
  isActive: boolean;
}

/**
 * Handle manage event types action from the calendar config menu
 */
export async function manageEventTypes(args: TypedActionArgs) {
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
        const existingTypes = await fetchEventTypesForRegion(
          args.context.teamId!,
        );
        return buildEventTypeForm(existingTypes);
      },
      { showLoading: true, loadingTitle: "Loading..." },
    );
  } else if (value === "edit") {
    await buildEventTypeListForm(args);
  }
}

/**
 * Fetch event types for the current region (includes nation-wide types)
 */
async function fetchEventTypesForRegion(
  teamId: string,
): Promise<EventTypeResponse[]> {
  const region = await api.slack.getRegion(teamId);
  if (!region) return [];

  const { eventTypes } = await api.eventType.all({
    orgIds: [region.org.id],
    statuses: ["active"],
  });

  return eventTypes.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetch region-specific event types only (for edit/delete)
 */
async function fetchRegionSpecificEventTypes(
  teamId: string,
): Promise<EventTypeResponse[]> {
  const region = await api.slack.getRegion(teamId);
  if (!region) return [];

  const { eventTypes } = await api.eventType.byOrgId({
    orgId: region.org.id,
    isActive: true,
  });

  return eventTypes.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build event type add/edit form
 */
export function buildEventTypeForm(
  existingTypes: EventTypeResponse[],
  editEventType?: EventTypeResponse,
): ModalView {
  const categoryOptions: PlainTextOption[] = EVENT_CATEGORIES.map((cat) => ({
    text: { type: "plain_text", text: cat.name },
    value: cat.value,
  }));

  // Find initial category option if editing
  const initialCategory = editEventType
    ? categoryOptions.find((opt) => opt.value === editEventType.eventCategory)
    : undefined;

  // Build list of existing event types for reference
  const existingTypesList = existingTypes
    .map((t) => ` - ${t.name}: ${t.acronym ?? "N/A"}`)
    .join("\n");

  const blocks: ModalView["blocks"] = [];

  // Only show the note for new event types (not editing)
  if (!editEventType) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Note:* Event Types are used to describe what you'll be doing at an event. They are different from Event Tags, which are used to give context to an event but do not change what you'll be doing at the event (e.g. 'VQ', 'Convergence', etc.).",
      },
    });
  }

  blocks.push(
    {
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_EVENT_TYPE_NAME,
      label: {
        type: "plain_text",
        text: editEventType ? "Edit Event Type" : "Create a new event type",
      },
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.CALENDAR_ADD_EVENT_TYPE_NAME,
        placeholder: {
          type: "plain_text",
          text: editEventType ? "Edit event type" : "New event type",
        },
        initial_value: editEventType?.name,
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_EVENT_TYPE_CATEGORY,
      label: { type: "plain_text", text: "Select an event category" },
      hint: {
        type: "plain_text",
        text: "This is required for national aggregations (achievements, etc).",
      },
      element: {
        type: "static_select",
        action_id: ACTIONS.CALENDAR_ADD_EVENT_TYPE_CATEGORY,
        placeholder: { type: "plain_text", text: "Select an event category" },
        options: categoryOptions,
        ...(initialCategory ? { initial_option: initialCategory } : {}),
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_EVENT_TYPE_ACRONYM,
      label: { type: "plain_text", text: "Event type acronym" },
      optional: true,
      hint: {
        type: "plain_text",
        text: "This is used for the calendar view to save on space. Defaults to first two letters of event type name. Make sure it's unique!",
      },
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.CALENDAR_ADD_EVENT_TYPE_ACRONYM,
        placeholder: { type: "plain_text", text: "Two letter acronym" },
        max_length: 2,
        initial_value: editEventType?.acronym ?? undefined,
      },
    },
  );

  // Add reference list of existing event types
  if (existingTypesList) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Event types in use:*\n\n${existingTypesList}`,
      },
    });
  }

  return {
    type: "modal",
    callback_id: ACTIONS.ADD_EVENT_TYPE_CALLBACK_ID,
    title: {
      type: "plain_text",
      text: editEventType ? "Edit an Event Type" : "Add an Event Type",
    },
    blocks,
    private_metadata: editEventType
      ? JSON.stringify({ event_type_id: editEventType.id })
      : undefined,
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
  };
}

/**
 * Handle event type add/edit submission
 */
export async function handleEventTypeAdd({
  ack,
  view,
  context,
}: TypedViewArgs) {
  await ack();

  const values = view.state.values;
  const metadata = view.private_metadata
    ? (JSON.parse(view.private_metadata) as Record<string, unknown>)
    : {};

  const name =
    values[ACTIONS.CALENDAR_ADD_EVENT_TYPE_NAME]?.[
      ACTIONS.CALENDAR_ADD_EVENT_TYPE_NAME
    ]?.value ?? "";
  const eventCategory =
    values[ACTIONS.CALENDAR_ADD_EVENT_TYPE_CATEGORY]?.[
      ACTIONS.CALENDAR_ADD_EVENT_TYPE_CATEGORY
    ]?.selected_option?.value ?? "first_f";
  const acronym =
    values[ACTIONS.CALENDAR_ADD_EVENT_TYPE_ACRONYM]?.[
      ACTIONS.CALENDAR_ADD_EVENT_TYPE_ACRONYM
    ]?.value;

  // Get the region for specificOrgId
  const region = await api.slack.getRegion(context.teamId!);
  if (!region) {
    logger.error(
      `Could not find region for team ${context.teamId ?? "unknown"}`,
    );
    return;
  }

  const input = {
    id: metadata.event_type_id as number | undefined,
    name,
    eventCategory,
    acronym: acronym ?? name.slice(0, 2).toUpperCase(),
    specificOrgId: region.org.id,
    isActive: true,
  };

  try {
    await api.eventType.crupdate(input);
  } catch (error) {
    logger.error("Failed to save event type", error);
  }
}

/**
 * Build event type list form for edit/delete
 */
export async function buildEventTypeListForm(args: TypedActionArgs) {
  const navCtx = createNavContext(args);

  await navigateToView(
    navCtx,
    async () => {
      const eventTypes = await fetchRegionSpecificEventTypes(
        args.context.teamId!,
      );

      const blocks: (
        | SectionBlock
        | { type: "context"; elements: { type: "mrkdwn"; text: string }[] }
      )[] = [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "_Only region-specific event types can be edited or deleted._",
            },
          ],
        },
      ];

      for (const eventType of eventTypes) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${eventType.name}* (${eventType.acronym ?? "N/A"})`,
          },
          accessory: {
            type: "static_select",
            action_id: `${ACTIONS.EVENT_TYPE_EDIT_DELETE}_${eventType.id}`,
            placeholder: { type: "plain_text", text: "Edit or Delete" },
            options: [
              { text: { type: "plain_text", text: "Edit" }, value: "edit" },
              {
                text: { type: "plain_text", text: "Delete" },
                value: "delete",
              },
            ],
            confirm: {
              title: { type: "plain_text", text: "Are you sure?" },
              text: {
                type: "plain_text",
                text: "Are you sure you want to edit / delete this Event Type? This cannot be undone.",
              },
              confirm: { type: "plain_text", text: "Yes, I'm sure" },
              deny: { type: "plain_text", text: "Whups, never mind" },
            },
          },
        });
      }

      return {
        type: "modal",
        callback_id: ACTIONS.EDIT_DELETE_EVENT_TYPE_CALLBACK_ID,
        title: { type: "plain_text", text: "Edit/Delete Event Types" },
        blocks:
          eventTypes.length > 0
            ? blocks
            : [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: "No region-specific event types found. Nation-wide event types cannot be edited here.",
                  },
                },
              ],
        close: { type: "plain_text", text: "Back" },
      };
    },
    { showLoading: true, loadingTitle: "Loading Event Types" },
  );
}

/**
 * Handle event type edit/delete action
 */
export async function handleEventTypeEditDelete(args: TypedActionArgs) {
  const { ack, body } = args;
  await ack();

  const action = (body as BlockAction).actions[0];
  if (!action || action.type !== "static_select") return;

  const eventTypeIdStr = action.action_id.split("_").pop();
  if (!eventTypeIdStr) return;
  const eventTypeId = parseInt(eventTypeIdStr);
  const value = action.selected_option?.value;
  const navCtx = createNavContext(args);

  if (value === "edit") {
    await navigateToView(
      navCtx,
      async () => {
        const { eventType } = await api.eventType.byId({ id: eventTypeId });
        if (!eventType) {
          return {
            type: "modal",
            title: { type: "plain_text", text: "Error" },
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "Event type not found" },
              },
            ],
          };
        }

        const existingTypes = await fetchEventTypesForRegion(
          args.context.teamId!,
        );
        return buildEventTypeForm(existingTypes, eventType);
      },
      { showLoading: true, loadingTitle: "Loading Event Type" },
    );
  } else if (value === "delete") {
    try {
      await api.eventType.delete(eventTypeId);
    } catch (error) {
      logger.error("Failed to delete event type", error);
    }
  }
}

/**
 * Register Event Type handlers
 */
export function registerEventTypeHandlers(app: App) {
  // View submission for add/edit
  app.view(ACTIONS.ADD_EVENT_TYPE_CALLBACK_ID, handleEventTypeAdd);

  // Regex for the dynamic action ID (edit/delete selection)
  app.action(
    new RegExp(`^${ACTIONS.EVENT_TYPE_EDIT_DELETE}_\\d+$`),
    handleEventTypeEditDelete,
  );
}

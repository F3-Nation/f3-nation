import type { App, BlockAction } from "@slack/bolt";
import type { ModalView, PlainTextOption, SectionBlock } from "@slack/types";
import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import type { TypedActionArgs, TypedViewArgs } from "../../types/bolt-types";
import { logger } from "../../lib/logger";
import { createNavContext, navigateToView } from "../../lib/view-navigation";

/**
 * Event tag colors - predefined color palette
 */
const EVENT_TAG_COLORS = [
  { name: "Red", value: "red" },
  { name: "Orange", value: "orange" },
  { name: "Yellow", value: "yellow" },
  { name: "Green", value: "green" },
  { name: "Blue", value: "blue" },
  { name: "Purple", value: "purple" },
  { name: "Pink", value: "pink" },
  { name: "Gray", value: "gray" },
] as const;

/**
 * Event Tag Response type
 */
interface EventTagResponse {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  specificOrgId: number | null;
  isActive: boolean;
}

/**
 * Handle manage event tags action from the calendar config menu
 */
export async function manageEventTags(args: TypedActionArgs) {
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
        const existingTags = await fetchEventTagsForRegion(
          args.context.teamId!,
        );
        return buildEventTagForm(existingTags);
      },
      { showLoading: true, loadingTitle: "Loading..." },
    );
  } else if (value === "edit") {
    await buildEventTagListForm(args);
  }
}

/**
 * Fetch event tags for the current region (includes nation-wide tags)
 */
async function fetchEventTagsForRegion(
  teamId: string,
): Promise<EventTagResponse[]> {
  const region = await api.slack.getOrg(teamId);
  if (!region) return [];

  const { eventTags } = await api.eventTag.all({
    orgIds: [region.org.id],
    statuses: ["active"],
  });

  return eventTags.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetch region-specific event tags only (for edit/delete)
 */
async function fetchRegionSpecificEventTags(
  teamId: string,
): Promise<EventTagResponse[]> {
  const region = await api.slack.getOrg(teamId);
  if (!region) return [];

  const { eventTags } = await api.eventTag.byOrgId({
    orgId: region.org.id,
    isActive: true,
  });

  return eventTags.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build event tag add/edit form
 */
export function buildEventTagForm(
  existingTags: EventTagResponse[],
  editEventTag?: EventTagResponse,
): ModalView {
  const colorOptions: PlainTextOption[] = EVENT_TAG_COLORS.map((c) => ({
    text: { type: "plain_text", text: c.name },
    value: c.value,
  }));

  // Find initial color option if editing
  const initialColor = editEventTag
    ? colorOptions.find((opt) => opt.value === editEventTag.color)
    : undefined;

  // Build list of existing tags with colors for reference
  const existingTagsList = existingTags
    .map((t) => ` - ${t.name}: ${t.color ?? "N/A"}`)
    .join("\n");

  const blocks: ModalView["blocks"] = [];

  // Only show the note for new event tags (not editing)
  if (!editEventTag) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Note:* Event tags are a way to add context about an event. They are different from Event Types, which are used to define the 'what you will do' of an event.",
      },
    });
  }

  blocks.push(
    {
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_EVENT_TAG_NAME,
      label: {
        type: "plain_text",
        text: editEventTag ? "Edit Event Tag" : "Create a new event tag",
      },
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.CALENDAR_ADD_EVENT_TAG_NAME,
        placeholder: {
          type: "plain_text",
          text: editEventTag ? "Edit event tag" : "New event tag",
        },
        initial_value: editEventTag?.name,
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_EVENT_TAG_COLOR,
      label: { type: "plain_text", text: "Event tag color" },
      hint: {
        type: "plain_text",
        text: "This is the color that will be shown on the calendar.",
      },
      element: {
        type: "static_select",
        action_id: ACTIONS.CALENDAR_ADD_EVENT_TAG_COLOR,
        placeholder: { type: "plain_text", text: "Select a color" },
        options: colorOptions,
        ...(initialColor ? { initial_option: initialColor } : {}),
      },
    },
  );

  // Add reference list of existing event tags with colors
  if (existingTagsList) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Colors already in use:*\n\n${existingTagsList}`,
      },
    });
  }

  return {
    type: "modal",
    callback_id: ACTIONS.ADD_EVENT_TAG_CALLBACK_ID,
    title: {
      type: "plain_text",
      text: editEventTag ? "Edit Event Tag" : "Add Event Tag",
    },
    blocks,
    private_metadata: editEventTag
      ? JSON.stringify({ event_tag_id: editEventTag.id })
      : undefined,
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
  };
}

/**
 * Handle event tag add/edit submission
 */
export async function handleEventTagAdd({ ack, view, context }: TypedViewArgs) {
  await ack();

  const values = view.state.values;
  const metadata = view.private_metadata
    ? (JSON.parse(view.private_metadata) as Record<string, unknown>)
    : {};

  const name =
    values[ACTIONS.CALENDAR_ADD_EVENT_TAG_NAME]?.[
      ACTIONS.CALENDAR_ADD_EVENT_TAG_NAME
    ]?.value ?? "";
  const color =
    values[ACTIONS.CALENDAR_ADD_EVENT_TAG_COLOR]?.[
      ACTIONS.CALENDAR_ADD_EVENT_TAG_COLOR
    ]?.selected_option?.value;

  // Get the region for specificOrgId
  const region = await api.slack.getOrg(context.teamId!);
  if (!region) {
    logger.error(
      `Could not find region for team ${context.teamId ?? "unknown"}`,
    );
    return;
  }

  const input = {
    id: metadata.event_tag_id as number | undefined,
    name,
    color: color ?? null,
    specificOrgId: region.org.id,
    isActive: true,
  };

  try {
    await api.eventTag.crupdate(input);
  } catch (error) {
    logger.error("Failed to save event tag", error);
  }
}

/**
 * Build event tag list form for edit/delete
 */
export async function buildEventTagListForm(args: TypedActionArgs) {
  const navCtx = createNavContext(args);

  await navigateToView(
    navCtx,
    async () => {
      const eventTags = await fetchRegionSpecificEventTags(
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
              text: "_Only custom event tags can be edited or deleted._",
            },
          ],
        },
      ];

      for (const eventTag of eventTags) {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${eventTag.name}* (${eventTag.color ?? "no color"})`,
          },
          accessory: {
            type: "static_select",
            action_id: `${ACTIONS.EVENT_TAG_EDIT_DELETE}_${eventTag.id}`,
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
                text: "Are you sure you want to edit / delete this Event Tag? This cannot be undone.",
              },
              confirm: { type: "plain_text", text: "Yes, I'm sure" },
              deny: { type: "plain_text", text: "Whups, never mind" },
            },
          },
        });
      }

      return {
        type: "modal",
        callback_id: ACTIONS.EDIT_DELETE_EVENT_TAG_CALLBACK_ID,
        title: { type: "plain_text", text: "Manage Event Tags" },
        blocks:
          eventTags.length > 0
            ? blocks
            : [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: "No custom event tags found. Nation-wide event tags cannot be edited here.",
                  },
                },
              ],
        close: { type: "plain_text", text: "Back" },
      };
    },
    { showLoading: true, loadingTitle: "Loading Event Tags" },
  );
}

/**
 * Handle event tag edit/delete action
 */
export async function handleEventTagEditDelete(args: TypedActionArgs) {
  const { ack, body } = args;
  await ack();

  const action = (body as BlockAction).actions[0];
  if (!action || action.type !== "static_select") return;

  const eventTagIdStr = action.action_id.split("_").pop();
  if (!eventTagIdStr) return;
  const eventTagId = parseInt(eventTagIdStr);
  const value = action.selected_option?.value;
  const navCtx = createNavContext(args);

  if (value === "edit") {
    await navigateToView(
      navCtx,
      async () => {
        const { eventTag } = await api.eventTag.byId({ id: eventTagId });
        if (!eventTag) {
          return {
            type: "modal",
            title: { type: "plain_text", text: "Error" },
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "Event tag not found" },
              },
            ],
          };
        }

        const existingTags = await fetchEventTagsForRegion(
          args.context.teamId!,
        );
        return buildEventTagForm(existingTags, eventTag);
      },
      { showLoading: true, loadingTitle: "Loading Event Tag" },
    );
  } else if (value === "delete") {
    try {
      await api.eventTag.delete(eventTagId);
    } catch (error) {
      logger.error("Failed to delete event tag", error);
    }
  }
}

/**
 * Register Event Tag handlers
 */
export function registerEventTagHandlers(app: App) {
  // View submission for add/edit
  app.view(ACTIONS.ADD_EVENT_TAG_CALLBACK_ID, handleEventTagAdd);

  // Regex for the dynamic action ID (edit/delete selection)
  app.action(
    new RegExp(`^${ACTIONS.EVENT_TAG_EDIT_DELETE}_\\d+$`),
    handleEventTagEditDelete,
  );
}

import type { App, BlockAction } from "@slack/bolt";
import type { ModalView, PlainTextOption, SectionBlock } from "@slack/types";
import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import type { TypedActionArgs, TypedViewArgs } from "../../types/bolt-types";
import type { LocationResponse } from "../../types/api-types";
import { logger } from "../../lib/logger";
import { createNavContext, navigateToView } from "../../lib/view-navigation";

/**
 * AO Response type matching the org router response
 */
interface AOResponse {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  logoUrl: string | null;
  defaultLocationId: number | null;
  meta: Record<string, string> | null;
}

/**
 * Handle manage AOs action from the calendar config menu
 */
export async function manageAOs(args: TypedActionArgs) {
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
        const locations = await fetchLocationsForRegion(args.context.teamId!);
        return buildAOAddForm(locations);
      },
      { showLoading: true, loadingTitle: "Loading..." },
    );
  } else if (value === "edit") {
    await buildAOListForm(args);
  }
}

/**
 * Fetch locations for the current region
 */
async function fetchLocationsForRegion(
  teamId: string,
): Promise<LocationResponse[]> {
  const region = await api.slack.getRegion(teamId);
  if (!region) return [];

  const { locations } = await api.location.all({
    regionIds: [region.org.id],
  });

  return locations.sort((a, b) => a.locationName.localeCompare(b.locationName));
}

/**
 * Get display name for a location
 */
function getLocationDisplayName(location: LocationResponse): string {
  const parts = [location.locationName];
  if (location.addressCity) {
    parts.push(`(${location.addressCity})`);
  }
  return parts.join(" ");
}

/**
 * Build AO add/edit form
 */
export function buildAOAddForm(
  locations: LocationResponse[],
  editAO?: AOResponse,
): ModalView {
  const locationOptions: PlainTextOption[] = locations.map((loc) => ({
    text: { type: "plain_text", text: getLocationDisplayName(loc) },
    value: loc.id.toString(),
  }));

  // Build initial values for the channel select if editing
  const slackChannelId = editAO?.meta?.slack_channel_id;

  const blocks: ModalView["blocks"] = [
    {
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_AO_NAME,
      label: { type: "plain_text", text: "AO Title" },
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.CALENDAR_ADD_AO_NAME,
        placeholder: { type: "plain_text", text: "Enter the AO name" },
        initial_value: editAO?.name,
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_AO_DESCRIPTION,
      label: { type: "plain_text", text: "Description" },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.CALENDAR_ADD_AO_DESCRIPTION,
        multiline: true,
        placeholder: {
          type: "plain_text",
          text: "Enter a description for the AO",
        },
        initial_value: editAO?.description ?? undefined,
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_AO_CHANNEL,
      label: { type: "plain_text", text: "Channel associated with this AO:" },
      element: {
        type: "conversations_select",
        action_id: ACTIONS.CALENDAR_ADD_AO_CHANNEL,
        placeholder: { type: "plain_text", text: "Select a channel" },
        filter: {
          include: ["public", "private"],
          exclude_bot_users: true,
        },
        ...(slackChannelId
          ? {
              default_to_current_conversation: false,
              initial_conversation: slackChannelId,
            }
          : {}),
      },
    },
  ];

  // Add location select if there are locations available
  if (locationOptions.length > 0) {
    const initialOption = editAO?.defaultLocationId
      ? locationOptions.find(
          (opt) => opt.value === editAO.defaultLocationId?.toString(),
        )
      : undefined;

    blocks.push({
      type: "input",
      block_id: ACTIONS.CALENDAR_ADD_AO_LOCATION,
      label: { type: "plain_text", text: "Default Location" },
      optional: true,
      element: {
        type: "static_select",
        action_id: ACTIONS.CALENDAR_ADD_AO_LOCATION,
        placeholder: { type: "plain_text", text: "Select a location" },
        options: locationOptions,
        ...(initialOption ? { initial_option: initialOption } : {}),
      },
    });
  }

  // Add existing logo image if editing and logo exists
  if (editAO?.logoUrl) {
    blocks.push({
      type: "image",
      image_url: editAO.logoUrl,
      alt_text: "AO Logo",
    });
  }

  // Note: File upload via input block requires special handling
  // For now, we'll skip the file upload field as it requires Slack app configuration
  // and cloud storage integration (like the Python implementation uses GCP/S3)

  return {
    type: "modal",
    callback_id: ACTIONS.ADD_AO_CALLBACK_ID,
    title: {
      type: "plain_text",
      text: editAO ? "Edit AO" : "Add an AO",
    },
    blocks,
    private_metadata: editAO ? JSON.stringify({ ao_id: editAO.id }) : undefined,
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
  };
}

/**
 * Handle AO add/edit submission
 */
export async function handleAOAdd({ ack, view, context }: TypedViewArgs) {
  await ack();

  const values = view.state.values;
  const metadata = view.private_metadata
    ? (JSON.parse(view.private_metadata) as Record<string, unknown>)
    : {};

  const name =
    values[ACTIONS.CALENDAR_ADD_AO_NAME]?.[ACTIONS.CALENDAR_ADD_AO_NAME]
      ?.value ?? "";
  const description =
    values[ACTIONS.CALENDAR_ADD_AO_DESCRIPTION]?.[
      ACTIONS.CALENDAR_ADD_AO_DESCRIPTION
    ]?.value;
  const slackChannelId =
    values[ACTIONS.CALENDAR_ADD_AO_CHANNEL]?.[ACTIONS.CALENDAR_ADD_AO_CHANNEL]
      ?.selected_conversation;
  const defaultLocationIdStr =
    values[ACTIONS.CALENDAR_ADD_AO_LOCATION]?.[ACTIONS.CALENDAR_ADD_AO_LOCATION]
      ?.selected_option?.value;
  const defaultLocationId = defaultLocationIdStr
    ? parseInt(defaultLocationIdStr)
    : null;

  // Get the region for parent organization
  const region = await api.slack.getRegion(context.teamId!);
  if (!region) {
    logger.error(
      `Could not find region for team ${context.teamId ?? "unknown"}`,
    );
    return;
  }

  // Build meta object, only including defined values
  const meta: Record<string, string> = {};
  if (slackChannelId) {
    meta.slack_channel_id = slackChannelId;
  }

  const input = {
    id: metadata.ao_id as number | undefined,
    parentId: region.org.id,
    orgType: "ao" as const,
    isActive: true,
    name,
    description: description ?? null,
    meta,
    defaultLocationId,
    // logoUrl would be set here if we implemented file upload
  };

  try {
    await api.org.crupdate(input);
  } catch (error) {
    logger.error("Failed to save AO", error);
  }
}

/**
 * Build AO list form for edit/delete
 */
export async function buildAOListForm(args: TypedActionArgs) {
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

      const { orgs } = await api.org.all({
        orgTypes: ["ao"],
        parentOrgIds: [region.org.id],
        statuses: ["active"],
      });

      const blocks: SectionBlock[] = orgs.map((ao) => ({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${ao.name}*${ao.description ? `\n${ao.description}` : ""}`,
        },
        accessory: {
          type: "static_select",
          action_id: `${ACTIONS.AO_EDIT_DELETE}_${ao.id}`,
          placeholder: { type: "plain_text", text: "Edit or Delete" },
          options: [
            { text: { type: "plain_text", text: "Edit" }, value: "edit" },
            { text: { type: "plain_text", text: "Delete" }, value: "delete" },
          ],
          confirm: {
            title: { type: "plain_text", text: "Are you sure?" },
            text: {
              type: "plain_text",
              text: "Are you sure you want to edit / delete this AO? This cannot be undone. Deleting an AO will also delete all associated series and events.",
            },
            confirm: { type: "plain_text", text: "Yes, I'm sure" },
            deny: { type: "plain_text", text: "Whups, never mind" },
          },
        },
      }));

      return {
        type: "modal",
        callback_id: ACTIONS.EDIT_DELETE_AO_CALLBACK_ID,
        title: { type: "plain_text", text: "Edit or Delete an AO" },
        blocks:
          blocks.length > 0
            ? blocks
            : [
                {
                  type: "section",
                  text: { type: "mrkdwn", text: "No AOs found." },
                },
              ],
        close: { type: "plain_text", text: "Back" },
      };
    },
    { showLoading: true, loadingTitle: "Loading AOs" },
  );
}

/**
 * Handle AO edit/delete action
 */
export async function handleAOEditDelete(args: TypedActionArgs) {
  const { ack, body } = args;
  await ack();

  const action = (body as BlockAction).actions[0];
  if (!action || action.type !== "static_select") return;

  const aoIdStr = action.action_id.split("_").pop();
  if (!aoIdStr) return;
  const aoId = parseInt(aoIdStr);
  const value = action.selected_option?.value;
  const navCtx = createNavContext(args);

  if (value === "edit") {
    await navigateToView(
      navCtx,
      async () => {
        const { org: ao } = await api.org.byId({ id: aoId });
        if (!ao) {
          return {
            type: "modal",
            title: { type: "plain_text", text: "Error" },
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "AO not found" },
              },
            ],
          };
        }

        const locations = await fetchLocationsForRegion(args.context.teamId!);
        return buildAOAddForm(locations, ao as AOResponse);
      },
      { showLoading: true, loadingTitle: "Loading AO Details" },
    );
  } else if (value === "delete") {
    try {
      await api.org.delete({ id: aoId, orgType: "ao" });
      // TODO: Also deactivate associated events/series as in Python implementation
      // This should ideally be handled by the API with cascade logic
    } catch (error) {
      logger.error("Failed to delete AO", error);
    }
  }
}

/**
 * Register AO handlers
 */
export function registerAOHandlers(app: App) {
  // View submission for add/edit
  app.view(ACTIONS.ADD_AO_CALLBACK_ID, handleAOAdd);

  // Regex for the dynamic action ID (edit/delete selection)
  app.action(
    new RegExp(`^${ACTIONS.AO_EDIT_DELETE}_\\d+$`),
    handleAOEditDelete,
  );
}

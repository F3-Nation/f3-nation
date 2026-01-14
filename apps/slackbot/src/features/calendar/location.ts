import type { App, BlockAction } from "@slack/bolt";
import type { ModalView } from "@slack/types";
import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import type { TypedActionArgs, TypedViewArgs } from "../../types/bolt-types";
import type { LocationResponse } from "../../types/api-types";
import { logger } from "../../lib/logger";
import { createNavContext, navigateToView } from "../../lib/view-navigation";

/**
 * Handle manage locations action
 */
export async function manageLocations(args: TypedActionArgs) {
  const { ack, body } = args;
  await ack();

  const action = (body as BlockAction).actions?.[0];
  if (!action) return;
  if (action.type !== "overflow" && action.type !== "static_select") return;

  const value = action.selected_option?.value;
  const navCtx = createNavContext(args);

  if (value === "add") {
    await navigateToView(navCtx, () => buildLocationAddForm());
  } else if (value === "edit") {
    await buildLocationListForm(args);
  }
}

/**
 * Build location add/edit form
 */
export function buildLocationAddForm(
  editLocation?: LocationResponse,
): ModalView {
  return {
    type: "modal",
    callback_id: ACTIONS.ADD_LOCATION_CALLBACK_ID,
    title: {
      type: "plain_text",
      text: editLocation ? "Edit Location" : "Add a Location",
    },
    blocks: [
      {
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_LOCATION_NAME,
        label: { type: "plain_text", text: "Location Name" },
        element: {
          type: "plain_text_input",
          action_id: ACTIONS.CALENDAR_ADD_LOCATION_NAME,
          placeholder: {
            type: "plain_text",
            text: "ie Central Park - Main Entrance",
          },
          initial_value: editLocation?.locationName,
        },
        hint: {
          type: "plain_text",
          text: "Use the actual name of the location, ie park name, etc. You will define the F3 AO name when you create AOs.",
        },
      },
      {
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_LOCATION_DESCRIPTION,
        label: { type: "plain_text", text: "Description" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: ACTIONS.CALENDAR_ADD_LOCATION_DESCRIPTION,
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Notes about the meetup spot, ie 'Meet at the flagpole near the entrance'",
          },
          initial_value: editLocation?.description ?? undefined,
        },
      },
      {
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_LOCATION_LAT,
        label: { type: "plain_text", text: "Latitude" },
        element: {
          type: "number_input",
          action_id: ACTIONS.CALENDAR_ADD_LOCATION_LAT,
          is_decimal_allowed: true,
          min_value: "-90",
          max_value: "90",
          placeholder: { type: "plain_text", text: "ie 34.0522" },
          initial_value: editLocation?.latitude?.toString(),
        },
      },
      {
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_LOCATION_LON,
        label: { type: "plain_text", text: "Longitude" },
        element: {
          type: "number_input",
          action_id: ACTIONS.CALENDAR_ADD_LOCATION_LON,
          is_decimal_allowed: true,
          min_value: "-180",
          max_value: "180",
          placeholder: { type: "plain_text", text: "ie -118.2437" },
          initial_value: editLocation?.longitude?.toString(),
        },
      },
      {
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_LOCATION_STREET,
        label: { type: "plain_text", text: "Location Street Address" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: ACTIONS.CALENDAR_ADD_LOCATION_STREET,
          placeholder: { type: "plain_text", text: "ie 123 Main St." },
          initial_value: editLocation?.addressStreet ?? undefined,
        },
      },
      {
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_LOCATION_STREET2,
        label: { type: "plain_text", text: "Location Address Line 2" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: ACTIONS.CALENDAR_ADD_LOCATION_STREET2,
          placeholder: { type: "plain_text", text: "ie Suite 200" },
          initial_value: editLocation?.addressStreet2 ?? undefined,
        },
      },
      {
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_LOCATION_CITY,
        label: { type: "plain_text", text: "Location City" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: ACTIONS.CALENDAR_ADD_LOCATION_CITY,
          placeholder: { type: "plain_text", text: "ie Los Angeles" },
          initial_value: editLocation?.addressCity ?? undefined,
        },
      },
      {
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_LOCATION_STATE,
        label: { type: "plain_text", text: "Location State" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: ACTIONS.CALENDAR_ADD_LOCATION_STATE,
          placeholder: { type: "plain_text", text: "ie CA" },
          initial_value: editLocation?.addressState ?? undefined,
        },
      },
      {
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_LOCATION_ZIP,
        label: { type: "plain_text", text: "Location Zip" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: ACTIONS.CALENDAR_ADD_LOCATION_ZIP,
          placeholder: { type: "plain_text", text: "ie 90210" },
          initial_value: editLocation?.addressZip ?? undefined,
        },
      },
      {
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_LOCATION_COUNTRY,
        label: { type: "plain_text", text: "Location Country" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: ACTIONS.CALENDAR_ADD_LOCATION_COUNTRY,
          placeholder: { type: "plain_text", text: "ie USA" },
          initial_value: editLocation?.addressCountry ?? undefined,
        },
        hint: {
          type: "plain_text",
          text: "If outside the US, please enter the country name.",
        },
      },
    ],
    private_metadata: editLocation
      ? JSON.stringify({ location_id: editLocation.id })
      : undefined,
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
  };
}

/**
 * Handle location add/edit submission
 */
export async function handleLocationAdd({ ack, view, context }: TypedViewArgs) {
  await ack();

  const values = view.state.values;
  const metadata = view.private_metadata
    ? (JSON.parse(view.private_metadata) as Record<string, unknown>)
    : {};

  const name =
    values[ACTIONS.CALENDAR_ADD_LOCATION_NAME]?.[
      ACTIONS.CALENDAR_ADD_LOCATION_NAME
    ]?.value ?? "";
  const description =
    values[ACTIONS.CALENDAR_ADD_LOCATION_DESCRIPTION]?.[
      ACTIONS.CALENDAR_ADD_LOCATION_DESCRIPTION
    ]?.value;
  const latitudeStr =
    values[ACTIONS.CALENDAR_ADD_LOCATION_LAT]?.[
      ACTIONS.CALENDAR_ADD_LOCATION_LAT
    ]?.value ?? "0";
  const longitudeStr =
    values[ACTIONS.CALENDAR_ADD_LOCATION_LON]?.[
      ACTIONS.CALENDAR_ADD_LOCATION_LON
    ]?.value ?? "0";
  const latitude = parseFloat(latitudeStr);
  const longitude = parseFloat(longitudeStr);
  const addressStreet =
    values[ACTIONS.CALENDAR_ADD_LOCATION_STREET]?.[
      ACTIONS.CALENDAR_ADD_LOCATION_STREET
    ]?.value;
  const addressStreet2 =
    values[ACTIONS.CALENDAR_ADD_LOCATION_STREET2]?.[
      ACTIONS.CALENDAR_ADD_LOCATION_STREET2
    ]?.value;
  const addressCity =
    values[ACTIONS.CALENDAR_ADD_LOCATION_CITY]?.[
      ACTIONS.CALENDAR_ADD_LOCATION_CITY
    ]?.value;
  const addressState =
    values[ACTIONS.CALENDAR_ADD_LOCATION_STATE]?.[
      ACTIONS.CALENDAR_ADD_LOCATION_STATE
    ]?.value;
  const addressZip =
    values[ACTIONS.CALENDAR_ADD_LOCATION_ZIP]?.[
      ACTIONS.CALENDAR_ADD_LOCATION_ZIP
    ]?.value;
  const addressCountry =
    values[ACTIONS.CALENDAR_ADD_LOCATION_COUNTRY]?.[
      ACTIONS.CALENDAR_ADD_LOCATION_COUNTRY
    ]?.value;

  // We need the orgId from region settings
  const region = await api.slack.getRegion(context.teamId!);
  if (!region) {
    logger.error(
      `Could not find region for team ${context.teamId ?? "unknown"}`,
    );
    return;
  }

  const input = {
    id: metadata.location_id as number | undefined,
    name,
    orgId: region.org.id,
    description,
    latitude,
    longitude,
    addressStreet,
    addressStreet2,
    addressCity,
    addressState,
    addressZip,
    addressCountry,
    isActive: true,
  };

  try {
    await api.location.crupdate(input);
  } catch (error) {
    logger.error("Failed to save location", error);
  }
}

/**
 * Build location list form for edit/delete
 */
export async function buildLocationListForm(args: TypedActionArgs) {
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

      const { locations } = await api.location.all({
        regionIds: [region.org.id],
      });

      const blocks = locations.map((loc) => ({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${loc.locationName}*\n${loc.addressStreet ?? ""}${loc.addressCity ? `, ${loc.addressCity}` : ""}`,
        },
        accessory: {
          type: "static_select",
          action_id: `${ACTIONS.LOCATION_EDIT_DELETE}_${loc.id}`,
          placeholder: { type: "plain_text", text: "Edit or Delete" },
          options: [
            { text: { type: "plain_text", text: "Edit" }, value: "edit" },
            { text: { type: "plain_text", text: "Delete" }, value: "delete" },
          ],
          confirm: {
            title: { type: "plain_text", text: "Are you sure?" },
            text: {
              type: "plain_text",
              text: "Are you sure you want to edit / delete this location? This cannot be undone.",
            },
            confirm: { type: "plain_text", text: "Yes, I'm sure" },
            deny: { type: "plain_text", text: "Whups, never mind" },
          },
        },
      }));

      return {
        type: "modal",
        callback_id: ACTIONS.EDIT_DELETE_LOCATION_CALLBACK_ID,
        title: { type: "plain_text", text: "Manage Locations" },
        blocks:
          blocks.length > 0
            ? blocks
            : [
                {
                  type: "section",
                  text: { type: "mrkdwn", text: "No locations found." },
                },
              ],
        close: { type: "plain_text", text: "Back" },
      };
    },
    { showLoading: true, loadingTitle: "Loading Locations" },
  );
}

/**
 * Handle location edit/delete action
 */
export async function handleLocationEditDelete(args: TypedActionArgs) {
  const { ack, body } = args;
  await ack();

  const action = (body as BlockAction).actions[0];
  if (!action || action.type !== "static_select") return;

  const locationIdStr = action.action_id.split("_").pop();
  if (!locationIdStr) return;
  const locationId = parseInt(locationIdStr);
  const value = action.selected_option?.value;
  const navCtx = createNavContext(args);

  if (value === "edit") {
    await navigateToView(
      navCtx,
      async () => {
        const { location } = await api.location.byId({ id: locationId });
        if (location) {
          return buildLocationAddForm(location as unknown as LocationResponse);
        }
        return {
          type: "modal",
          title: { type: "plain_text", text: "Error" },
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "Location not found" },
            },
          ],
        };
      },
      { showLoading: true, loadingTitle: "Loading Location" },
    );
  } else if (value === "delete") {
    try {
      await api.location.delete(locationId);
    } catch (error) {
      logger.error("Failed to delete location", error);
    }
  }
}

/**
 * Register Location handlers
 */
export function registerLocationHandlers(app: App) {
  app.view(ACTIONS.ADD_LOCATION_CALLBACK_ID, handleLocationAdd);

  // Regex for the dynamic action ID
  app.action(
    new RegExp(`^${ACTIONS.LOCATION_EDIT_DELETE}_\\d+$`),
    handleLocationEditDelete,
  );
}

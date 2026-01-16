import type { BlockAction } from "@slack/bolt";
import type { PlainTextOption } from "@slack/types";
import dayjs from "dayjs";

import { api } from "../../lib/api-client";
import type { NavigationContext } from "../../lib/view-navigation";
import { createNavContext, navigateToView } from "../../lib/view-navigation";
import { ACTIONS } from "../../constants/actions";
import type {
  BlockList,
  NavigationMetadata,
  SlackStateValues,
  TypedActionArgs,
  TypedViewArgs,
} from "../../types/bolt-types";
import { logger } from "../../lib/logger";

/**
 * Handle manage event instances action
 */
export async function manageEventInstances(args: TypedActionArgs) {
  const { ack, body } = args;
  await ack();

  const action = (body as BlockAction).actions?.[0];
  if (!action) return;

  const value =
    action.type === "button"
      ? action.value
      : (action as { selected_option?: { value: string } }).selected_option
          ?.value;
  const navCtx = createNavContext(args);

  if (value === "add" || action.type === "button") {
    // Default to list if it's the main button, but if it came from somewhere else with "add"
    if (value === "add") {
      await buildAddEventInstanceForm(navCtx);
    } else {
      await buildListEventInstanceForm(navCtx);
    }
  } else if (value === "edit") {
    await buildListEventInstanceForm(navCtx);
  }
}

/**
 * Build add/edit event instance form
 */
export async function buildAddEventInstanceForm(
  navCtx: NavigationContext,
  editInstanceId?: number,
) {
  await navigateToView(
    navCtx,
    async () => {
      const region = await api.slack.getRegion(navCtx.teamId);
      if (!region) throw new Error("Region not found");

      const [
        orgResult,
        locationResult,
        eventTypeResult,
        eventTagResult,
        existingInstance,
      ] = await Promise.all([
        api.org.all({ orgTypes: ["ao"], parentOrgIds: [region.org.id] }),
        api.location.all({ regionIds: [region.org.id] }),
        api.eventType.all({ orgIds: [region.org.id], statuses: ["active"] }),
        api.eventTag.all({ orgIds: [region.org.id], statuses: ["active"] }),
        editInstanceId
          ? api.eventInstance.byId({ id: editInstanceId })
          : Promise.resolve(null),
      ]);

      const aos = orgResult.orgs;
      const locations = locationResult.locations;
      const eventTypes = eventTypeResult.eventTypes;
      const eventTags = eventTagResult.eventTags;

      const aoOptions: PlainTextOption[] = aos.map((ao) => ({
        text: { type: "plain_text", text: ao.name },
        value: ao.id.toString(),
      }));

      const locationOptions: PlainTextOption[] = locations.map((loc) => ({
        text: { type: "plain_text", text: loc.locationName },
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

      const blocks: BlockList = [
        {
          type: "input",
          block_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_AO,
          label: { type: "plain_text", text: "AO" },
          element: {
            type: "static_select",
            action_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_AO,
            placeholder: { type: "plain_text", text: "Select an AO" },
            options: aoOptions,
            ...(existingInstance?.orgId
              ? {
                  initial_option: aoOptions.find(
                    (o) => parseInt(o.value ?? "0") === existingInstance.orgId,
                  ),
                }
              : {}),
          },
        },
        {
          type: "input",
          block_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_LOCATION,
          label: { type: "plain_text", text: "Location" },
          optional: true,
          element: {
            type: "static_select",
            action_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_LOCATION,
            placeholder: { type: "plain_text", text: "Select location" },
            options: locationOptions,
            ...(existingInstance?.locationId
              ? {
                  initial_option: locationOptions.find(
                    (o) =>
                      parseInt(o.value ?? "0") === existingInstance.locationId,
                  ),
                }
              : {}),
          },
        },
        {
          type: "input",
          block_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_TYPE,
          label: { type: "plain_text", text: "Event Type" },
          element: {
            type: "static_select",
            action_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_TYPE,
            placeholder: { type: "plain_text", text: "Select type" },
            options: eventTypeOptions,
            ...(existingInstance?.eventTypes?.[0]
              ? {
                  initial_option: eventTypeOptions.find(
                    (o) =>
                      parseInt(o.value ?? "0") ===
                      existingInstance?.eventTypes?.[0]?.eventTypeId,
                  ),
                }
              : {}),
          },
        },
        {
          type: "input",
          block_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_TAG,
          label: { type: "plain_text", text: "Event Tag (optional)" },
          optional: true,
          element: {
            type: "static_select",
            action_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_TAG,
            placeholder: { type: "plain_text", text: "Select tag" },
            options: eventTagOptions,
            ...(existingInstance?.eventTags?.[0]
              ? {
                  initial_option: eventTagOptions.find(
                    (o) =>
                      parseInt(o.value ?? "0") ===
                      existingInstance?.eventTags?.[0]?.eventTagId,
                  ),
                }
              : {}),
          },
        },
        {
          type: "input",
          block_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_START_DATE,
          label: { type: "plain_text", text: "Date" },
          element: {
            type: "datepicker",
            action_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_START_DATE,
            initial_date:
              existingInstance?.startDate ?? dayjs().format("YYYY-MM-DD"),
          },
        },
        {
          type: "input",
          block_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_START_TIME,
          label: { type: "plain_text", text: "Start Time" },
          element: {
            type: "timepicker",
            action_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_START_TIME,
            initial_time: existingInstance?.startTime
              ? `${existingInstance.startTime.slice(0, 2)}:${existingInstance.startTime.slice(2)}`
              : "05:30",
          },
        },
        {
          type: "input",
          block_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_END_TIME,
          label: { type: "plain_text", text: "End Time (optional)" },
          optional: true,
          element: {
            type: "timepicker",
            action_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_END_TIME,
            initial_time: existingInstance?.endTime
              ? `${existingInstance.endTime.slice(0, 2)}:${existingInstance.endTime.slice(2)}`
              : undefined,
          },
        },
        {
          type: "input",
          block_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_NAME,
          label: { type: "plain_text", text: "Event Name (optional)" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_NAME,
            initial_value: existingInstance?.name ?? "",
          },
        },
        {
          type: "input",
          block_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_DESCRIPTION,
          label: { type: "plain_text", text: "Description (optional)" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_DESCRIPTION,
            multiline: true,
            initial_value: existingInstance?.description ?? "",
          },
        },
      ];

      const optionsList = [
        {
          text: { type: "plain_text" as const, text: "Make event private" },
          value: "private",
        },
        {
          text: { type: "plain_text" as const, text: "Exclude from PAX Vault" },
          value: "exclude_from_pax_vault",
        },
        {
          text: { type: "plain_text" as const, text: "No auto-preblasts" },
          value: "no_auto_preblasts",
        },
        {
          text: { type: "plain_text" as const, text: "Highlight" },
          value: "highlight",
        },
      ];

      const initialOptions: PlainTextOption[] = [];
      if (existingInstance?.isPrivate) initialOptions.push(optionsList[0]!);
      if (existingInstance?.meta?.exclude_from_pax_vault)
        initialOptions.push(optionsList[1]!);
      if (existingInstance?.meta?.do_not_send_auto_preblasts)
        initialOptions.push(optionsList[2]!);
      if (existingInstance?.highlight) initialOptions.push(optionsList[3]!);

      blocks.push({
        type: "input",
        block_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_OPTIONS,
        label: { type: "plain_text", text: "Options" },
        optional: true,
        element: {
          type: "checkboxes",
          action_id: ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_OPTIONS,
          options: optionsList,
          ...(initialOptions.length > 0
            ? { initial_options: initialOptions }
            : {}),
        },
      });

      return {
        type: "modal",
        callback_id: ACTIONS.ADD_EVENT_INSTANCE_CALLBACK_ID,
        title: {
          type: "plain_text",
          text: editInstanceId ? "Edit Event" : "Add Event",
        },
        blocks,
        submit: { type: "plain_text", text: "Save" },
        close: { type: "plain_text", text: "Cancel" },
        private_metadata: JSON.stringify({
          ...navCtx.metadata,
          event_instance_id: editInstanceId,
        }),
      };
    },
    { showLoading: true },
  );
}

/**
 * Build list of event instances for edit/delete
 */
export async function buildListEventInstanceForm(navCtx: NavigationContext) {
  await navigateToView(
    navCtx,
    async () => {
      const region = await api.slack.getRegion(navCtx.teamId);
      if (!region) throw new Error("Region not found");

      const filters = (navCtx.metadata.filters as Record<string, string>) ?? {};
      const aoOrgId = filters[ACTIONS.CALENDAR_MANAGE_EVENT_INSTANCE_AO];
      const startDate =
        filters[ACTIONS.CALENDAR_MANAGE_EVENT_INSTANCE_DATE] ??
        dayjs().format("YYYY-MM-DD");

      const [orgResult, instancesResult] = await Promise.all([
        api.org.all({ parentOrgIds: [region.org.id], orgTypes: ["ao"] }),
        api.eventInstance.all({
          regionOrgId: region.org.id,
          aoOrgId: aoOrgId ? parseInt(aoOrgId) : undefined,
          startDate,
          pageSize: 40,
        }),
      ]);

      const aos = orgResult.orgs;
      const aoOptions: PlainTextOption[] = aos.map((ao) => ({
        text: { type: "plain_text", text: ao.name },
        value: ao.id.toString(),
      }));

      const blocks: BlockList = [
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Add Single Event" },
              action_id: ACTIONS.CALENDAR_MANAGE_EVENT_INSTANCES,
              value: "add",
            },
          ],
        },
        {
          type: "input",
          block_id: ACTIONS.CALENDAR_MANAGE_EVENT_INSTANCE_AO,
          label: { type: "plain_text", text: "Filter by AO" },
          optional: true,
          dispatch_action: true,
          element: {
            type: "static_select",
            action_id: ACTIONS.CALENDAR_MANAGE_EVENT_INSTANCE_AO,
            placeholder: { type: "plain_text", text: "Select AO" },
            options: aoOptions,
            ...(aoOrgId
              ? { initial_option: aoOptions.find((o) => o.value === aoOrgId) }
              : {}),
          },
        },
        {
          type: "input",
          block_id: ACTIONS.CALENDAR_MANAGE_EVENT_INSTANCE_DATE,
          label: { type: "plain_text", text: "Filter by Date" },
          optional: true,
          dispatch_action: true,
          element: {
            type: "datepicker",
            action_id: ACTIONS.CALENDAR_MANAGE_EVENT_INSTANCE_DATE,
            initial_date: startDate,
          },
        },
      ];

      instancesResult.eventInstances.forEach((inst) => {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${inst.name}*\n${dayjs(inst.startDate).format("MMMM D, YYYY")} at ${inst.startTime}`,
          },
          accessory: {
            type: "overflow",
            action_id: `${ACTIONS.EVENT_INSTANCE_EDIT_DELETE}_${inst.id}`,
            options: [
              { text: { type: "plain_text", text: "Edit" }, value: "edit" },
              { text: { type: "plain_text", text: "Delete" }, value: "delete" },
            ],
            confirm: {
              title: { type: "plain_text", text: "Are you sure?" },
              text: {
                type: "plain_text",
                text: "Do you want to delete this event instance?",
              },
              confirm: { type: "plain_text", text: "Delete" },
              deny: { type: "plain_text", text: "Cancel" },
            },
          },
        });
      });

      return {
        type: "modal",
        callback_id: ACTIONS.EDIT_DELETE_EVENT_INSTANCE_CALLBACK_ID,
        title: { type: "plain_text", text: "Manage Single Events" },
        blocks,
        close: { type: "plain_text", text: "Back" },
        private_metadata: JSON.stringify(navCtx.metadata),
      };
    },
    { showLoading: true },
  );
}

/**
 * Handle form submission
 */
export async function handleEventInstanceAdd({ ack, view }: TypedViewArgs) {
  await ack();

  const values = view.state.values as unknown as SlackStateValues;
  const metadata = JSON.parse(view.private_metadata) as NavigationMetadata & {
    event_instance_id?: number;
  };

  const getVal = (blockId: string, actionId: string) =>
    values[blockId]?.[actionId];

  const aoId = parseInt(
    getVal(
      ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_AO,
      ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_AO,
    )?.selected_option?.value ?? "0",
  );
  const locationId = parseInt(
    getVal(
      ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_LOCATION,
      ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_LOCATION,
    )?.selected_option?.value ?? "0",
  );
  const eventTypeId = parseInt(
    getVal(
      ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_TYPE,
      ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_TYPE,
    )?.selected_option?.value ?? "0",
  );
  const eventTagId = parseInt(
    getVal(
      ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_TAG,
      ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_TAG,
    )?.selected_option?.value ?? "0",
  );
  const name = getVal(
    ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_NAME,
    ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_NAME,
  )?.value;
  const description = getVal(
    ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_DESCRIPTION,
    ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_DESCRIPTION,
  )?.value;
  const startDate = getVal(
    ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_START_DATE,
    ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_START_DATE,
  )?.selected_date;
  const startTime = getVal(
    ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_START_TIME,
    ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_START_TIME,
  )?.selected_time?.replace(":", "");
  let endTime = getVal(
    ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_END_TIME,
    ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_END_TIME,
  )?.selected_time?.replace(":", "");

  if (!endTime && startTime) {
    const startT = getVal(
      ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_START_TIME,
      ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_START_TIME,
    )?.selected_time;
    if (startT) {
      endTime = dayjs(`2000-01-01 ${startT}`).add(1, "hour").format("HHmm");
    }
  }

  const selectedOptions =
    getVal(
      ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_OPTIONS,
      ACTIONS.CALENDAR_ADD_EVENT_INSTANCE_OPTIONS,
    )?.selected_options?.map((o) => o.value) ?? [];

  const meta: Record<string, boolean> = {};
  if (selectedOptions.includes("exclude_from_pax_vault"))
    meta.exclude_from_pax_vault = true;
  if (selectedOptions.includes("no_auto_preblasts"))
    meta.do_not_send_auto_preblasts = true;

  const payload = {
    id: metadata.event_instance_id,
    name: name ?? undefined,
    description: description ?? undefined,
    orgId: aoId,
    locationId: locationId || undefined,
    eventTypeId: eventTypeId || undefined,
    eventTagId: eventTagId || undefined,
    startDate: startDate ?? undefined,
    startTime,
    endTime,
    isPrivate: selectedOptions.includes("private"),
    highlight: selectedOptions.includes("highlight"),
    meta,
  };

  try {
    await api.eventInstance.crupdate(payload);
  } catch (error) {
    logger.error("Failed to save event instance", error);
  }
}

/**
 * Handle edit/delete from list
 */
export async function handleEventInstanceEditDelete(args: TypedActionArgs) {
  const { ack, body } = args;
  await ack();

  const action = (body as BlockAction).actions?.[0];
  if (!action || action.type !== "overflow") return;

  const instanceId = parseInt(action.action_id.split("_").pop() ?? "0");
  const value = action.selected_option?.value;
  const navCtx = createNavContext(args);

  if (value === "edit") {
    await buildAddEventInstanceForm(navCtx, instanceId);
  } else if (value === "delete") {
    try {
      await api.eventInstance.delete({ id: instanceId });
      await buildListEventInstanceForm(navCtx);
    } catch (error) {
      logger.error("Failed to delete event instance", error);
    }
  }
}

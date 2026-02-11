import type { App, BlockAction } from "@slack/bolt";
import type { ModalView } from "@slack/types";
import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import { logger } from "../../lib/logger";
import type { NavigationContext } from "../../lib/view-navigation";
import { createNavContext, navigateToView } from "../../lib/view-navigation";
import type { CustomField, OrgSettings } from "../../types";
import type {
  BlockList,
  NavigationMetadata,
  SlackStateValues,
  TypedActionArgs,
  TypedViewArgs,
} from "../../types/bolt-types";
import { parseNavMetadata, stringifyNavMetadata } from "../../types/bolt-types";

/** Human-readable type names for display */
const FIELD_TYPE_LABELS: Record<CustomField["type"], string> = {
  text: "Text",
  select: "Dropdown",
  multi_select: "Multi-Select",
  user_select: "User Select",
};

/** Inverse mapping for form submission */
const FIELD_TYPE_VALUES: Record<string, CustomField["type"]> = {
  Text: "text",
  Dropdown: "select",
  "Multi-Select": "multi_select",
  "User Select": "user_select",
};

/**
 * Build the Custom Fields menu modal.
 * Lists all custom fields with enable/disable toggles and edit/delete buttons.
 */
export function buildCustomFieldsMenuModal(
  orgSettings?: OrgSettings,
  metadata?: NavigationMetadata,
): ModalView {
  const customFields = orgSettings?.custom_fields ?? [];
  const blocks: BlockList = [];

  if (customFields.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No custom fields configured yet. Add a new field to get started._",
      },
    });
  } else {
    for (const field of customFields) {
      // Build info label
      let label = `*${field.name}*\nType: ${FIELD_TYPE_LABELS[field.type]}`;
      if (
        (field.type === "select" || field.type === "multi_select") &&
        field.options?.length
      ) {
        label += `\nOptions: ${field.options.join(", ")}`;
      }

      // Enable/Disable radio buttons
      const enableActionId = `${ACTIONS.CUSTOM_FIELD_ENABLE_PREFIX}${field.name}`;
      blocks.push({
        type: "input",
        block_id: enableActionId,
        label: { type: "plain_text", text: label },
        element: {
          type: "radio_buttons",
          action_id: enableActionId,
          initial_option: {
            text: {
              type: "plain_text",
              text: field.enabled ? "Enabled" : "Disabled",
            },
            value: field.enabled ? "enable" : "disable",
          },
          options: [
            { text: { type: "plain_text", text: "Enabled" }, value: "enable" },
            {
              text: { type: "plain_text", text: "Disabled" },
              value: "disable",
            },
          ],
        },
      });

      // Edit/Delete buttons
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Edit" },
            action_id: ACTIONS.CUSTOM_FIELD_EDIT,
            value: field.name,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Delete" },
            action_id: ACTIONS.CUSTOM_FIELD_DELETE,
            value: field.name,
            style: "danger",
          },
        ],
      });

      blocks.push({ type: "divider" });
    }
  }

  // Add "New custom field" button
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: ":heavy_plus_sign: New Custom Field",
        },
        action_id: ACTIONS.CUSTOM_FIELD_ADD,
        style: "primary",
      },
    ],
  });

  return {
    type: "modal",
    callback_id: ACTIONS.CUSTOM_FIELD_MENU_CALLBACK_ID,
    title: { type: "plain_text", text: "Custom Fields" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Back" },
    private_metadata: metadata ? stringifyNavMetadata(metadata) : undefined,
    blocks,
  } as ModalView;
}

/**
 * Build the Add/Edit Custom Field modal.
 */
export function buildCustomFieldAddEditModal(
  existingField?: CustomField,
  metadata?: NavigationMetadata,
): ModalView {
  const isEdit = !!existingField;

  const blocks: BlockList = [
    {
      type: "input",
      block_id: ACTIONS.CUSTOM_FIELD_NAME,
      label: { type: "plain_text", text: "Field Name" },
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.CUSTOM_FIELD_NAME,
        placeholder: {
          type: "plain_text",
          text: "Enter the name of the field",
        },
        max_length: 40,
        ...(existingField?.name ? { initial_value: existingField.name } : {}),
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CUSTOM_FIELD_TYPE,
      label: { type: "plain_text", text: "Field Type" },
      element: {
        type: "static_select",
        action_id: ACTIONS.CUSTOM_FIELD_TYPE,
        placeholder: { type: "plain_text", text: "Select a type" },
        initial_option: {
          text: {
            type: "plain_text",
            text: existingField
              ? FIELD_TYPE_LABELS[existingField.type]
              : "Dropdown",
          },
          value: existingField
            ? FIELD_TYPE_LABELS[existingField.type]
            : "Dropdown",
        },
        options: Object.values(FIELD_TYPE_LABELS).map((label) => ({
          text: { type: "plain_text", text: label },
          value: label,
        })),
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CUSTOM_FIELD_OPTIONS,
      label: { type: "plain_text", text: "Dropdown Options" },
      optional: true,
      hint: {
        type: "plain_text",
        text: "Comma-separated options. Only required for Dropdown and Multi-Select types.",
      },
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.CUSTOM_FIELD_OPTIONS,
        placeholder: {
          type: "plain_text",
          text: "Option 1, Option 2, Option 3",
        },
        max_length: 200,
        ...(existingField?.options?.length
          ? { initial_value: existingField.options.join(", ") }
          : {}),
      },
    },
  ];

  // Store original field name in metadata for edit case
  const finalMetadata: NavigationMetadata = {
    _navDepth: metadata?._navDepth ?? 0,
    ...metadata,
    _editFieldName: existingField?.name,
  };

  return {
    type: "modal",
    callback_id: ACTIONS.CUSTOM_FIELD_ADD_CALLBACK_ID,
    title: {
      type: "plain_text",
      text: isEdit ? "Edit Custom Field" : "Add Custom Field",
    },
    submit: { type: "plain_text", text: isEdit ? "Save" : "Add" },
    close: { type: "plain_text", text: "Cancel" },
    notify_on_close: true,
    private_metadata: stringifyNavMetadata(finalMetadata),
    blocks,
  } as ModalView;
}

/**
 * Build the Delete Confirmation modal.
 */
export function buildCustomFieldDeleteConfirmModal(
  fieldName: string,
  metadata?: NavigationMetadata,
): ModalView {
  const finalMetadata: NavigationMetadata = {
    _navDepth: metadata?._navDepth ?? 0,
    ...metadata,
    _deleteFieldName: fieldName,
  };

  return {
    type: "modal",
    callback_id: ACTIONS.CUSTOM_FIELD_DELETE_CONFIRM_CALLBACK_ID,
    title: { type: "plain_text", text: "Delete Field?" },
    submit: { type: "plain_text", text: "Delete" },
    close: { type: "plain_text", text: "Cancel" },
    private_metadata: stringifyNavMetadata(finalMetadata),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:warning: Are you sure you want to delete the custom field *"${fieldName}"*?\n\nThis action cannot be undone. Any data stored in this field for existing backblasts will be preserved but no longer visible.`,
        },
      },
    ],
  } as ModalView;
}

/**
 * Handle Custom Fields menu submission (save enable/disable states)
 */
export async function handleCustomFieldsMenuSubmit({
  ack,
  view,
  body,
  context,
}: TypedViewArgs) {
  await ack();

  const teamId = body.team?.id;
  if (!teamId) {
    logger.warn("No team ID found in custom fields menu submission");
    return;
  }

  const values = view.state.values as unknown as SlackStateValues;
  const existingFields = context.orgSettings?.custom_fields ?? [];

  // Update enabled state for each field
  const updatedFields = existingFields.map((field) => {
    const enableKey = `${ACTIONS.CUSTOM_FIELD_ENABLE_PREFIX}${field.name}`;
    const enableValue = values[enableKey]?.[enableKey]?.selected_option?.value;

    return {
      ...field,
      enabled: enableValue === "enable",
    };
  });

  try {
    await api.slack.updateSpaceSettings(teamId, {
      custom_fields: updatedFields,
    });
    logger.info(`Updated custom field enable states for team ${teamId}`);
  } catch (error) {
    logger.error("Error saving custom fields settings:", error);
  }
}

/**
 * Handle Add/Edit Custom Field form submission
 */
export async function handleCustomFieldAddEditSubmit(
  args: TypedViewArgs,
): Promise<void> {
  const { view, body, context, client } = args;

  const teamId = body.team?.id;
  if (!teamId) {
    logger.warn("No team ID found in custom field add/edit submission");
    await args.ack();
    return;
  }

  const values = view.state.values as unknown as SlackStateValues;
  const metadata = parseNavMetadata(view.private_metadata);
  const originalFieldName = metadata._editFieldName as string | undefined;
  const isEdit = !!originalFieldName;

  const fieldName = (
    values[ACTIONS.CUSTOM_FIELD_NAME]?.[ACTIONS.CUSTOM_FIELD_NAME]?.value ?? ""
  ).trim();
  const fieldTypeLabel =
    values[ACTIONS.CUSTOM_FIELD_TYPE]?.[ACTIONS.CUSTOM_FIELD_TYPE]
      ?.selected_option?.value ?? "Dropdown";
  const fieldType = FIELD_TYPE_VALUES[fieldTypeLabel] ?? "select";
  const optionsStr = (
    values[ACTIONS.CUSTOM_FIELD_OPTIONS]?.[ACTIONS.CUSTOM_FIELD_OPTIONS]
      ?.value ?? ""
  ).trim();

  // Validation: name is required
  if (!fieldName) {
    await args.ack({
      response_action: "errors",
      errors: {
        [ACTIONS.CUSTOM_FIELD_NAME]: "Field name is required",
      },
    });
    return;
  }

  // Validation: options required for select types
  if ((fieldType === "select" || fieldType === "multi_select") && !optionsStr) {
    await args.ack({
      response_action: "errors",
      errors: {
        [ACTIONS.CUSTOM_FIELD_OPTIONS]:
          "Options are required for Dropdown and Multi-Select types",
      },
    });
    return;
  }

  // Parse options
  const options =
    fieldType === "select" || fieldType === "multi_select"
      ? optionsStr
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean)
      : undefined;

  // Build the new/updated field
  const newField: CustomField = {
    name: fieldName,
    type: fieldType,
    options,
    enabled: true,
  };

  // Get existing fields and update
  const existingFields = context.orgSettings?.custom_fields ?? [];
  let updatedFields: CustomField[];

  if (isEdit) {
    // Replace the existing field
    updatedFields = existingFields.map((f) =>
      f.name === originalFieldName ? newField : f,
    );
  } else {
    // Check for duplicate name
    if (existingFields.some((f) => f.name === fieldName)) {
      await args.ack({
        response_action: "errors",
        errors: {
          [ACTIONS.CUSTOM_FIELD_NAME]: "A field with this name already exists",
        },
      });
      return;
    }
    updatedFields = [...existingFields, newField];
  }

  await args.ack();

  try {
    await api.slack.updateSpaceSettings(teamId, {
      custom_fields: updatedFields,
    });
    logger.info(
      `${isEdit ? "Updated" : "Added"} custom field "${fieldName}" for team ${teamId}`,
    );

    // Update the menu modal with new data
    // Need to fetch fresh settings to get updated org settings
    const space = await api.slack.getSpace(teamId);
    if (space && view.previous_view_id) {
      const updatedOrgSettings = space.settings ?? undefined;
      const menuModal = buildCustomFieldsMenuModal(updatedOrgSettings, {
        _navDepth: metadata._navDepth,
      });
      await client.views.update({
        view_id: view.previous_view_id,
        view: menuModal,
      });
    }
  } catch (error) {
    logger.error("Error saving custom field:", error);
  }
}

/**
 * Handle Delete Confirmation submission
 */
export async function handleCustomFieldDeleteConfirm(
  args: TypedViewArgs,
): Promise<void> {
  const { ack, view, body, context, client } = args;
  await ack();

  const teamId = body.team?.id;
  if (!teamId) {
    logger.warn("No team ID found in custom field delete submission");
    return;
  }

  const metadata = parseNavMetadata(view.private_metadata);
  const fieldName = metadata._deleteFieldName as string | undefined;

  if (!fieldName) {
    logger.warn("No field name found in delete confirmation metadata");
    return;
  }

  const existingFields = context.orgSettings?.custom_fields ?? [];
  const updatedFields = existingFields.filter((f) => f.name !== fieldName);

  try {
    await api.slack.updateSpaceSettings(teamId, {
      custom_fields: updatedFields,
    });
    logger.info(`Deleted custom field "${fieldName}" for team ${teamId}`);

    // Update the menu modal with new data
    const space = await api.slack.getSpace(teamId);
    if (space && view.previous_view_id) {
      const updatedOrgSettings = space.settings ?? undefined;
      const menuModal = buildCustomFieldsMenuModal(updatedOrgSettings, {
        _navDepth: metadata._navDepth,
      });
      await client.views.update({
        view_id: view.previous_view_id,
        view: menuModal,
      });
    }
  } catch (error) {
    logger.error("Error deleting custom field:", error);
  }
}

/**
 * Open the custom fields menu modal
 */
async function openCustomFieldsMenu(
  navCtx: NavigationContext,
  orgSettings?: OrgSettings,
) {
  await navigateToView(navCtx, (metadata) =>
    buildCustomFieldsMenuModal(orgSettings, metadata),
  );
}

/**
 * Open the add/edit field modal
 */
async function openCustomFieldAddEdit(
  navCtx: NavigationContext,
  existingField?: CustomField,
) {
  await navigateToView(navCtx, (metadata) =>
    buildCustomFieldAddEditModal(existingField, metadata),
  );
}

/**
 * Open the delete confirmation modal
 */
async function openCustomFieldDeleteConfirm(
  navCtx: NavigationContext,
  fieldName: string,
) {
  await navigateToView(navCtx, (metadata) =>
    buildCustomFieldDeleteConfirmModal(fieldName, metadata),
  );
}

/**
 * Register custom fields settings handlers
 */
export function registerCustomFieldsSettingsHandlers(app: App) {
  // Action: Open Custom Fields Menu
  app.action(ACTIONS.CONFIG_CUSTOM_FIELDS, async (args: TypedActionArgs) => {
    const { ack, context } = args;
    await ack();
    const navCtx = createNavContext(args);
    await openCustomFieldsMenu(navCtx, context.orgSettings);
  });

  // Action: Add New Custom Field
  app.action(ACTIONS.CUSTOM_FIELD_ADD, async (args: TypedActionArgs) => {
    const { ack } = args;
    await ack();
    const navCtx = createNavContext(args);
    await openCustomFieldAddEdit(navCtx);
  });

  // Action: Edit Custom Field
  app.action(ACTIONS.CUSTOM_FIELD_EDIT, async (args: TypedActionArgs) => {
    const { ack, body, context } = args;
    await ack();

    const action = (body as BlockAction).actions?.[0];
    if (!action || !("value" in action) || !action.value) {
      logger.warn("No field name found in edit action");
      return;
    }
    const fieldName = action.value;

    const customFields = context.orgSettings?.custom_fields;
    const existingField = customFields?.find((f) => f.name === fieldName);

    const navCtx = createNavContext(args);
    await openCustomFieldAddEdit(navCtx, existingField);
  });

  // Action: Delete Custom Field (confirmation)
  app.action(ACTIONS.CUSTOM_FIELD_DELETE, async (args: TypedActionArgs) => {
    const { ack, body } = args;
    await ack();

    const action = (body as BlockAction).actions?.[0];
    if (!action || !("value" in action) || !action.value) {
      logger.warn("No field name found in delete action");
      return;
    }
    const fieldName = action.value;

    const navCtx = createNavContext(args);
    await openCustomFieldDeleteConfirm(navCtx, fieldName);
  });

  // View: Custom Fields Menu Submit (save enable/disable states)
  app.view(ACTIONS.CUSTOM_FIELD_MENU_CALLBACK_ID, handleCustomFieldsMenuSubmit);

  // View: Add/Edit Custom Field Submit
  app.view(
    ACTIONS.CUSTOM_FIELD_ADD_CALLBACK_ID,
    handleCustomFieldAddEditSubmit,
  );

  // View: Delete Confirmation Submit
  app.view(
    ACTIONS.CUSTOM_FIELD_DELETE_CONFIRM_CALLBACK_ID,
    handleCustomFieldDeleteConfirm,
  );
}

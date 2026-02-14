/**
 * Positions Feature
 *
 * Handles SLT (Shared Leadership Team) position management:
 * - Assign users to positions at region or AO level
 * - Create, edit, and delete custom positions
 *
 * Migrated from Python features/positions.py
 */

import type { App, BlockAction } from "@slack/bolt";
import type {
  InputBlock,
  ModalView,
  PlainTextOption,
  SectionBlock,
} from "@slack/types";
import type { WebClient } from "@slack/web-api";
import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import { logger } from "../../lib/logger";
import { resolveSlackUsers } from "../../lib/slack-user-resolver";
import type {
  BlockList,
  ExtendedContext,
  TypedActionArgs,
  TypedViewArgs,
} from "../../types/bolt-types";
import { createNavContext, navigateToView } from "../../lib/view-navigation";

/**
 * Build the SLT configuration form
 * Shows a level selector and position user assignments
 */
export async function buildSltConfigForm(
  context: ExtendedContext,
  selectedOrgId?: number,
): Promise<ModalView> {
  const teamId = context.teamId;
  const regionOrgId = context.orgId;

  if (!teamId || !regionOrgId) {
    return {
      type: "modal",
      callback_id: ACTIONS.CONFIG_SLT_CALLBACK_ID,
      title: { type: "plain_text", text: "SLT Members" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Unable to load SLT settings. Region not configured.",
          },
        },
      ],
      close: { type: "plain_text", text: "Close" },
    };
  }

  // Use selected org or default to region
  const orgId = selectedOrgId ?? regionOrgId;

  // Fetch AOs for the level selector
  const { orgs: aos } = await api.org.all({
    orgTypes: ["ao"],
    parentOrgIds: [regionOrgId],
    statuses: ["active"],
  });

  // Build level options: Region + all AOs
  const levelOptions: PlainTextOption[] = [
    { text: { type: "plain_text" as const, text: "Region" }, value: "0" },
    ...aos.map((ao) => ({
      text: { type: "plain_text" as const, text: ao.name },
      value: ao.id.toString(),
    })),
  ];

  // Determine the initial value for the selector
  const initialLevelValue = orgId === regionOrgId ? "0" : orgId.toString();

  // Fetch positions with assignments for this org
  const { positions } = await api.position.getAssignments({
    orgId,
    regionOrgId,
  });

  const blocks: BlockList = [
    {
      type: "input",
      block_id: ACTIONS.SLT_LEVEL_SELECT,
      label: {
        type: "plain_text",
        text: "Select the SLT positions for...",
      },
      element: {
        type: "static_select",
        action_id: ACTIONS.SLT_LEVEL_SELECT,
        options: levelOptions,
        initial_option: levelOptions.find(
          (opt) => opt.value === initialLevelValue,
        ),
      },
      dispatch_action: true,
    },
  ];

  // Add a multi-user select for each position
  for (const position of positions) {
    const block: InputBlock = {
      type: "input",
      block_id: `${ACTIONS.SLT_SELECT}${position.id}_${orgId}`,
      label: { type: "plain_text", text: position.name },
      optional: true,
      element: {
        type: "multi_users_select",
        action_id: `${ACTIONS.SLT_SELECT}${position.id}_${orgId}`,
        placeholder: { type: "plain_text", text: "Select SLT Members..." },
      },
    };

    // Add hint if position has description
    if (position.description) {
      block.hint = { type: "plain_text", text: position.description };
    }

    // Note: initial_users would need user IDs from slack - we'd need to look them up
    // For now, we'll show empty and users need to re-select
    // TODO: Add endpoint to get slack IDs from F3 user IDs

    blocks.push(block);
  }

  // Add action buttons
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: ":heavy_plus_sign: New Position" },
        action_id: ACTIONS.CONFIG_NEW_POSITION,
      },
      {
        type: "button",
        text: { type: "plain_text", text: ":pencil2: Edit Positions" },
        action_id: ACTIONS.CONFIG_EDIT_POSITIONS,
      },
    ],
  });

  return {
    type: "modal",
    callback_id: ACTIONS.CONFIG_SLT_CALLBACK_ID,
    title: { type: "plain_text", text: "SLT Members" },
    blocks,
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    private_metadata: JSON.stringify({ orgId }),
  };
}

/**
 * Handle opening the SLT config form
 */
export async function handleOpenSltConfig(args: TypedActionArgs) {
  const { ack, context } = args;
  await ack();

  const navCtx = createNavContext(args);
  await navigateToView(navCtx, () => buildSltConfigForm(context), {
    showLoading: true,
    loadingTitle: "Loading SLT Settings",
  });
}

/**
 * Handle level selector change - update the form with positions for selected level
 */
export async function handleLevelSelectChange(args: TypedActionArgs) {
  const { ack, body, context, client } = args;
  await ack();

  const action = (body as BlockAction).actions[0];
  if (!action || action.type !== "static_select") return;

  const selectedValue = action.selected_option?.value;
  const regionOrgId = context.orgId;

  if (!selectedValue || !regionOrgId) return;

  // "0" means region, otherwise it's an AO ID
  const selectedOrgId =
    selectedValue === "0" ? regionOrgId : parseInt(selectedValue);

  // Update the modal with the new org's positions
  const modal = await buildSltConfigForm(context, selectedOrgId);

  const viewId = (body as BlockAction).view?.id;
  if (!viewId) {
    logger.error("No view ID for SLT level select update");
    return;
  }

  try {
    await client.views.update({
      view_id: viewId,
      view: modal,
    });
  } catch (error) {
    logger.error("Failed to update SLT config form:", error);
  }
}

/**
 * Handle SLT config form submission
 * Saves the position assignments for the org
 */
export async function handleSltConfigSubmit(args: TypedViewArgs) {
  const { ack, view, context, client } = args;
  await ack();

  const teamId = context.teamId;
  if (!teamId) {
    logger.error("No teamId in context for SLT config submit");
    return;
  }

  const values = view.state.values;
  const metadata = view.private_metadata
    ? (JSON.parse(view.private_metadata) as { orgId?: number })
    : {};
  const orgId = metadata.orgId ?? context.orgId;

  if (!orgId) {
    logger.error("No orgId for SLT config submit");
    return;
  }

  // Parse form values to extract position assignments
  const assignments: { positionId: number; userIds: number[] }[] = [];

  for (const [blockId, blockValue] of Object.entries(values)) {
    // Block IDs are like: slt-select123_456 (positionId_orgId)
    if (blockId.startsWith(ACTIONS.SLT_SELECT)) {
      const match = blockId.match(
        new RegExp(`^${ACTIONS.SLT_SELECT}(\\d+)_(\\d+)$`),
      );
      if (!match?.[1] || !match[2]) continue;

      const positionId = parseInt(match[1]);
      const blockOrgId = parseInt(match[2]);

      // Only process assignments for the current org
      if (blockOrgId !== orgId) continue;

      const actionId = `${ACTIONS.SLT_SELECT}${positionId}_${blockOrgId}`;
      const selectedUsers =
        (
          blockValue[actionId] as {
            selected_users?: string[];
          }
        )?.selected_users ?? [];

      // Resolve Slack user IDs to F3 user IDs
      if (selectedUsers.length > 0) {
        const resolved = await resolveSlackUsers({
          client: client as unknown as WebClient,
          slackIds: selectedUsers,
          teamId,
        });

        const userIds = resolved.resolved.map((u) => u.userId);

        if (resolved.failed.length > 0) {
          logger.warn(
            `Failed to resolve some users for position ${positionId}: ${resolved.failed.join(", ")}`,
          );
        }

        assignments.push({ positionId, userIds });
      } else {
        // Empty selection - clear assignments for this position
        assignments.push({ positionId, userIds: [] });
      }
    }
  }

  try {
    await api.position.updateAssignments({
      orgId,
      assignments,
    });
    logger.info(`Updated position assignments for org ${orgId}`);
  } catch (error) {
    logger.error("Failed to update position assignments:", error);
  }
}

/**
 * Build the new position form
 */
export function buildNewPositionForm(
  regionOrgId: number,
  selectedOrgId: number,
): ModalView {
  // Determine org type based on whether it's region or AO
  const isRegion = selectedOrgId === regionOrgId;

  const blocks: BlockList = [
    {
      type: "input",
      block_id: ACTIONS.CONFIG_NEW_POSITION_NAME,
      label: { type: "plain_text", text: "Position Name" },
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.CONFIG_NEW_POSITION_NAME,
        placeholder: {
          type: "plain_text",
          text: "Enter the new position name...",
        },
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CONFIG_NEW_POSITION_DESCRIPTION,
      label: { type: "plain_text", text: "Position Description" },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.CONFIG_NEW_POSITION_DESCRIPTION,
        placeholder: {
          type: "plain_text",
          text: "Enter the new position description...",
        },
        multiline: true,
      },
    },
  ];

  return {
    type: "modal",
    callback_id: ACTIONS.NEW_POSITION_CALLBACK_ID,
    title: { type: "plain_text", text: "New Position" },
    blocks,
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    private_metadata: JSON.stringify({
      orgId: selectedOrgId,
      orgType: isRegion ? "region" : "ao",
    }),
  };
}

/**
 * Handle new position button click
 */
export async function handleNewPositionClick(args: TypedActionArgs) {
  const { ack, body, context } = args;
  await ack();

  const regionOrgId = context.orgId;
  if (!regionOrgId) return;

  // Get the currently selected org from the parent view's state
  const viewState = (body as BlockAction).view?.state?.values;
  const levelSelectValue =
    viewState?.[ACTIONS.SLT_LEVEL_SELECT]?.[ACTIONS.SLT_LEVEL_SELECT]
      ?.selected_option?.value;

  const selectedOrgId = levelSelectValue
    ? levelSelectValue === "0"
      ? regionOrgId
      : parseInt(levelSelectValue)
    : regionOrgId;

  const navCtx = createNavContext(args);
  await navigateToView(navCtx, () =>
    buildNewPositionForm(regionOrgId, selectedOrgId),
  );
}

/**
 * Handle new position form submission
 */
export async function handleNewPositionSubmit(args: TypedViewArgs) {
  const { ack, view, context } = args;

  const values = view.state.values;
  const metadata = view.private_metadata
    ? (JSON.parse(view.private_metadata) as {
        orgId?: number;
        orgType?: "region" | "ao";
      })
    : {};

  const regionOrgId = context.orgId;
  const name =
    values[ACTIONS.CONFIG_NEW_POSITION_NAME]?.[ACTIONS.CONFIG_NEW_POSITION_NAME]
      ?.value ?? "";
  const description =
    values[ACTIONS.CONFIG_NEW_POSITION_DESCRIPTION]?.[
      ACTIONS.CONFIG_NEW_POSITION_DESCRIPTION
    ]?.value ?? null;

  if (!name.trim()) {
    await ack({
      response_action: "errors",
      errors: {
        [ACTIONS.CONFIG_NEW_POSITION_NAME]: "Position name is required",
      },
    });
    return;
  }

  await ack();

  try {
    await api.position.crupdate({
      name: name.trim(),
      description,
      orgId: regionOrgId,
      orgType: metadata.orgType ?? "region",
      isActive: true,
    });
    logger.info(`Created new position: ${name}`);
  } catch (error) {
    logger.error("Failed to create position:", error);
  }
}

/**
 * Build the position list form for editing/deleting
 */
export async function buildPositionListForm(
  context: ExtendedContext,
): Promise<ModalView> {
  const regionOrgId = context.orgId;

  if (!regionOrgId) {
    return {
      type: "modal",
      callback_id: ACTIONS.EDIT_DELETE_POSITION_CALLBACK_ID,
      title: { type: "plain_text", text: "Edit/Delete Positions" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "Unable to load positions." },
        },
      ],
      close: { type: "plain_text", text: "Close" },
    };
  }

  // Fetch only region-specific positions (not global)
  const { positions } = await api.position.byOrgId({
    orgId: regionOrgId,
    isActive: true,
  });

  const blocks: BlockList = [
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_Only region-specific positions can be edited or deleted._",
        },
      ],
    },
  ];

  if (positions.length === 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No custom positions found. Use 'New Position' to create one.",
      },
    });
  } else {
    for (const position of positions) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${position.name}*${position.description ? `\n${position.description}` : ""}`,
        },
        accessory: {
          type: "static_select",
          action_id: `${ACTIONS.POSITION_EDIT_DELETE}_${position.id}`,
          placeholder: { type: "plain_text", text: "Edit or Delete" },
          options: [
            { text: { type: "plain_text", text: "Edit" }, value: "edit" },
            { text: { type: "plain_text", text: "Delete" }, value: "delete" },
          ],
          confirm: {
            title: { type: "plain_text", text: "Are you sure?" },
            text: {
              type: "plain_text",
              text: "Are you sure you want to edit / delete this Position? This cannot be undone.",
            },
            confirm: { type: "plain_text", text: "Yes, I'm sure" },
            deny: { type: "plain_text", text: "Whups, never mind" },
          },
        },
      } as SectionBlock);
    }
  }

  return {
    type: "modal",
    callback_id: ACTIONS.EDIT_DELETE_POSITION_CALLBACK_ID,
    title: { type: "plain_text", text: "Edit/Delete Positions" },
    blocks,
    close: { type: "plain_text", text: "Back" },
  };
}

/**
 * Handle edit positions button click
 */
export async function handleEditPositionsClick(args: TypedActionArgs) {
  const { ack, context } = args;
  await ack();

  const navCtx = createNavContext(args);
  await navigateToView(navCtx, () => buildPositionListForm(context), {
    showLoading: true,
    loadingTitle: "Loading Positions",
  });
}

/**
 * Build edit position form
 */
export function buildEditPositionForm(position: {
  id: number;
  name: string;
  description: string | null;
}): ModalView {
  const blocks: BlockList = [
    {
      type: "input",
      block_id: ACTIONS.CONFIG_NEW_POSITION_NAME,
      label: { type: "plain_text", text: "Position Name" },
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.CONFIG_NEW_POSITION_NAME,
        initial_value: position.name,
        placeholder: { type: "plain_text", text: "Enter the position name..." },
      },
    },
    {
      type: "input",
      block_id: ACTIONS.CONFIG_NEW_POSITION_DESCRIPTION,
      label: { type: "plain_text", text: "Position Description" },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: ACTIONS.CONFIG_NEW_POSITION_DESCRIPTION,
        initial_value: position.description ?? undefined,
        placeholder: {
          type: "plain_text",
          text: "Enter the position description...",
        },
        multiline: true,
      },
    },
  ];

  return {
    type: "modal",
    callback_id: ACTIONS.EDIT_POSITION_CALLBACK_ID,
    title: { type: "plain_text", text: "Edit Position" },
    blocks,
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    private_metadata: JSON.stringify({ positionId: position.id }),
  };
}

/**
 * Handle position edit/delete action
 */
export async function handlePositionEditDelete(args: TypedActionArgs) {
  const { ack, body } = args;
  await ack();

  const action = (body as BlockAction).actions[0];
  if (!action || action.type !== "static_select") return;

  const positionIdStr = action.action_id.split("_").pop();
  if (!positionIdStr) return;
  const positionId = parseInt(positionIdStr);
  const value = action.selected_option?.value;
  const navCtx = createNavContext(args);

  if (value === "edit") {
    await navigateToView(
      navCtx,
      async () => {
        const { position } = await api.position.byId({ id: positionId });
        if (!position) {
          return {
            type: "modal",
            title: { type: "plain_text", text: "Error" },
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: "Position not found" },
              },
            ],
          };
        }
        return buildEditPositionForm(position);
      },
      { showLoading: true, loadingTitle: "Loading Position" },
    );
  } else if (value === "delete") {
    try {
      await api.position.delete(positionId);
      logger.info(`Deleted position ${positionId}`);
    } catch (error) {
      logger.error("Failed to delete position:", error);
    }
  }
}

/**
 * Handle edit position form submission
 */
export async function handleEditPositionSubmit(args: TypedViewArgs) {
  const { ack, view } = args;

  const values = view.state.values;
  const metadata = view.private_metadata
    ? (JSON.parse(view.private_metadata) as { positionId?: number })
    : {};

  const positionId = metadata.positionId;
  if (!positionId) {
    await ack();
    return;
  }

  const name =
    values[ACTIONS.CONFIG_NEW_POSITION_NAME]?.[ACTIONS.CONFIG_NEW_POSITION_NAME]
      ?.value ?? "";
  const description =
    values[ACTIONS.CONFIG_NEW_POSITION_DESCRIPTION]?.[
      ACTIONS.CONFIG_NEW_POSITION_DESCRIPTION
    ]?.value ?? null;

  if (!name.trim()) {
    await ack({
      response_action: "errors",
      errors: {
        [ACTIONS.CONFIG_NEW_POSITION_NAME]: "Position name is required",
      },
    });
    return;
  }

  await ack();

  try {
    await api.position.crupdate({
      id: positionId,
      name: name.trim(),
      description,
    });
    logger.info(`Updated position ${positionId}`);
  } catch (error) {
    logger.error("Failed to update position:", error);
  }
}

/**
 * Register Positions feature handlers
 */
export function registerPositionsFeature(app: App) {
  // Open SLT config from settings menu
  app.action(ACTIONS.CONFIG_SLT, handleOpenSltConfig);

  // Level selector change
  app.action(ACTIONS.SLT_LEVEL_SELECT, handleLevelSelectChange);

  // SLT config form submission
  app.view(ACTIONS.CONFIG_SLT_CALLBACK_ID, handleSltConfigSubmit);

  // New position button
  app.action(ACTIONS.CONFIG_NEW_POSITION, handleNewPositionClick);

  // New position form submission
  app.view(ACTIONS.NEW_POSITION_CALLBACK_ID, handleNewPositionSubmit);

  // Edit positions button
  app.action(ACTIONS.CONFIG_EDIT_POSITIONS, handleEditPositionsClick);

  // Position edit/delete action (dynamic ID)
  app.action(
    new RegExp(`^${ACTIONS.POSITION_EDIT_DELETE}_\\d+$`),
    handlePositionEditDelete,
  );

  // Edit position form submission
  app.view(ACTIONS.EDIT_POSITION_CALLBACK_ID, handleEditPositionSubmit);
}

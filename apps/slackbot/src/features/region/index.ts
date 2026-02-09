/**
 * Region Feature
 *
 * Handles region info editing:
 * - Edit region name, description, logo, website, email, social links
 * - Manage admin user assignments
 *
 * Migrated from Python features/region.py
 */

import type { App } from "@slack/bolt";
import type { InputBlock, ModalView } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import { ACTIONS } from "../../constants/actions";
import { api } from "../../lib/api-client";
import { env } from "../../lib/env";
import {
  extractFilesFromValues,
  uploadSlackFile,
} from "../../lib/file-upload";
import { logger } from "../../lib/logger";
import { resolveSlackUsers } from "../../lib/slack-user-resolver";
import type {
  BlockList,
  ExtendedContext,
  TypedActionArgs,
  TypedViewArgs,
} from "../../types/bolt-types";
import { createNavContext, navigateToView } from "../../lib/view-navigation";

const EMAIL_REGEX = /^[^@]+@[^@]+\.[^@]+$/;
const URL_REGEX =
  /^https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=]*)$/;

/**
 * Build the region editing form modal.
 * Fetches current org data and admin Slack IDs to pre-populate the form.
 */
export async function buildRegionForm(
  context: ExtendedContext,
): Promise<ModalView> {
  try {
    return await _buildRegionFormInner(context);
  } catch (error) {
    logger.error("Unexpected error building region form:", error);
    return {
      type: "modal",
      callback_id: ACTIONS.REGION_CALLBACK_ID,
      title: { type: "plain_text", text: "Edit Region" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:x: An error occurred loading the region form: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        },
      ],
      close: { type: "plain_text", text: "Close" },
    };
  }
}

async function _buildRegionFormInner(
  context: ExtendedContext,
): Promise<ModalView> {
  const teamId = context.teamId;
  const orgId = context.orgId;

  if (!teamId || !orgId) {
    return {
      type: "modal",
      callback_id: ACTIONS.REGION_CALLBACK_ID,
      title: { type: "plain_text", text: "Edit Region" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Unable to load region info. Region not configured.",
          },
        },
      ],
      close: { type: "plain_text", text: "Close" },
    };
  }

  // Fetch org data and admin users in parallel
  let orgResult: Awaited<ReturnType<typeof api.org.byId>>;
  let adminsResult: Awaited<ReturnType<typeof api.slack.getOrgAdmins>>;

  try {
    [orgResult, adminsResult] = await Promise.all([
      api.org.byId({ id: orgId }),
      api.slack.getOrgAdmins(orgId, teamId).catch(() => ({ admins: [] })),
    ]);
  } catch (error) {
    logger.error("Failed to fetch region data:", error);
    return {
      type: "modal",
      callback_id: ACTIONS.REGION_CALLBACK_ID,
      title: { type: "plain_text", text: "Edit Region" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Failed to load region data. Please try again.",
          },
        },
      ],
      close: { type: "plain_text", text: "Close" },
    };
  }

  const org = orgResult.org;
  if (!org) {
    return {
      type: "modal",
      callback_id: ACTIONS.REGION_CALLBACK_ID,
      title: { type: "plain_text", text: "Edit Region" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "Region not found." },
        },
      ],
      close: { type: "plain_text", text: "Close" },
    };
  }

  const adminSlackIds = adminsResult.admins
    .map((a) => a.slackId)
    .filter(Boolean);

  const blocks: BlockList = [];

  // Show current logo if available and accessible
  if (org.logoUrl) {
    try {
      const headRes = await fetch(org.logoUrl, { method: "HEAD" });
      if (headRes.ok) {
        blocks.push({
          type: "image",
          image_url: org.logoUrl,
          alt_text: "Region Logo",
        });
      }
    } catch {
      logger.warn(`Region logo URL not accessible: ${org.logoUrl}`);
    }
  }

  // Region Name
  const nameBlock: InputBlock = {
    type: "input",
    block_id: ACTIONS.REGION_NAME,
    label: { type: "plain_text", text: "Region Title" },
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.REGION_NAME,
      placeholder: { type: "plain_text", text: "Enter the Region name" },
    },
  };
  if (org.name) {
    (nameBlock.element as { initial_value?: string }).initial_value = org.name;
  }
  blocks.push(nameBlock);

  // Region Description
  const descBlock: InputBlock = {
    type: "input",
    block_id: ACTIONS.REGION_DESCRIPTION,
    label: { type: "plain_text", text: "Region Description" },
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.REGION_DESCRIPTION,
      placeholder: {
        type: "plain_text",
        text: "Enter a description for the Region",
      },
      multiline: true,
    },
  };
  if (org.description) {
    (descBlock.element as { initial_value?: string }).initial_value =
      org.description;
  }
  blocks.push(descBlock);

  // Region Logo (file upload)
  blocks.push({
    type: "input",
    block_id: ACTIONS.REGION_LOGO,
    label: { type: "plain_text", text: "Region Logo" },
    optional: true,
    element: {
      type: "file_input",
      action_id: ACTIONS.REGION_LOGO,
      max_files: 1,
      filetypes: ["png", "jpg", "heic", "bmp"],
    },
  } as InputBlock);

  // Region Admins
  const adminsBlock: InputBlock = {
    type: "input",
    block_id: ACTIONS.REGION_ADMINS,
    label: { type: "plain_text", text: "Region Admins" },
    hint: {
      type: "plain_text",
      text: "These users will have admin permissions for the Region (modify schedules, backblasts, etc.)",
    },
    element: {
      type: "multi_users_select",
      action_id: ACTIONS.REGION_ADMINS,
      placeholder: { type: "plain_text", text: "Select the Region admins" },
    },
  };
  if (adminSlackIds.length > 0) {
    (adminsBlock.element as { initial_users?: string[] }).initial_users =
      adminSlackIds;
  }
  blocks.push(adminsBlock);

  // Region Website
  const websiteBlock: InputBlock = {
    type: "input",
    block_id: ACTIONS.REGION_WEBSITE,
    label: { type: "plain_text", text: "Region Website" },
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.REGION_WEBSITE,
      placeholder: { type: "plain_text", text: "Enter the Region website" },
    },
  };
  if (org.website) {
    (websiteBlock.element as { initial_value?: string }).initial_value =
      org.website;
  }
  blocks.push(websiteBlock);

  // Region Email
  const emailBlock: InputBlock = {
    type: "input",
    block_id: ACTIONS.REGION_EMAIL,
    label: { type: "plain_text", text: "Region Email" },
    optional: true,
    element: {
      type: "email_text_input",
      action_id: ACTIONS.REGION_EMAIL,
      placeholder: { type: "plain_text", text: "Enter the Region email" },
    },
  } as InputBlock;
  if (org.email) {
    (emailBlock.element as { initial_value?: string }).initial_value =
      org.email;
  }
  blocks.push(emailBlock);

  // Region Twitter
  const twitterBlock: InputBlock = {
    type: "input",
    block_id: ACTIONS.REGION_TWITTER,
    label: { type: "plain_text", text: "Region Twitter" },
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.REGION_TWITTER,
      placeholder: { type: "plain_text", text: "Enter the Region Twitter" },
    },
  };
  if (org.twitter) {
    (twitterBlock.element as { initial_value?: string }).initial_value =
      org.twitter;
  }
  blocks.push(twitterBlock);

  // Region Facebook
  const facebookBlock: InputBlock = {
    type: "input",
    block_id: ACTIONS.REGION_FACEBOOK,
    label: { type: "plain_text", text: "Region Facebook" },
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.REGION_FACEBOOK,
      placeholder: { type: "plain_text", text: "Enter the Region Facebook" },
    },
  };
  if (org.facebook) {
    (facebookBlock.element as { initial_value?: string }).initial_value =
      org.facebook;
  }
  blocks.push(facebookBlock);

  // Region Instagram
  const instagramBlock: InputBlock = {
    type: "input",
    block_id: ACTIONS.REGION_INSTAGRAM,
    label: { type: "plain_text", text: "Region Instagram" },
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: ACTIONS.REGION_INSTAGRAM,
      placeholder: { type: "plain_text", text: "Enter the Region Instagram" },
    },
  };
  if (org.instagram) {
    (instagramBlock.element as { initial_value?: string }).initial_value =
      org.instagram;
  }
  blocks.push(instagramBlock);

  return {
    type: "modal",
    callback_id: ACTIONS.REGION_CALLBACK_ID,
    title: { type: "plain_text", text: "Edit Region" },
    blocks,
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
  };
}

/**
 * Handle the region edit form submission.
 * Validates input, uploads logo, updates org fields, and syncs admin list.
 */
export async function handleRegionEdit(args: TypedViewArgs) {
  const { ack, view, context, client } = args;
  await ack();

  const teamId = context.teamId;
  const orgId = context.orgId;

  if (!teamId || !orgId) {
    logger.error("No teamId or orgId in context for region edit");
    return;
  }

  const values = view.state.values;

  // Extract form values
  const name =
    values[ACTIONS.REGION_NAME]?.[ACTIONS.REGION_NAME]?.value ?? "";
  const description =
    values[ACTIONS.REGION_DESCRIPTION]?.[ACTIONS.REGION_DESCRIPTION]?.value ??
    null;

  let website =
    values[ACTIONS.REGION_WEBSITE]?.[ACTIONS.REGION_WEBSITE]?.value ?? null;
  if (website && !URL_REGEX.test(website)) {
    website = null;
  }

  let email =
    values[ACTIONS.REGION_EMAIL]?.[ACTIONS.REGION_EMAIL]?.value ?? null;
  if (email && !EMAIL_REGEX.test(email)) {
    email = null;
  }

  const twitter =
    values[ACTIONS.REGION_TWITTER]?.[ACTIONS.REGION_TWITTER]?.value ?? null;
  const facebook =
    values[ACTIONS.REGION_FACEBOOK]?.[ACTIONS.REGION_FACEBOOK]?.value ?? null;
  const instagram =
    values[ACTIONS.REGION_INSTAGRAM]?.[ACTIONS.REGION_INSTAGRAM]?.value ?? null;

  // Handle logo upload
  let logoUrl: string | null | undefined;
  const files = extractFilesFromValues(
    values as Parameters<typeof extractFilesFromValues>[0],
    ACTIONS.REGION_LOGO,
  );

  logger.debug("Region logo file extraction", {
    filesCount: files.length,
    hasFiles: files.length > 0,
    fileIds: files.map((f) => f.id),
  });

  if (files.length > 0) {
    const space = await api.slack.getSpace(teamId);
    const botToken = space?.botToken;

    logger.debug("Region logo upload attempt", {
      hasBotToken: !!botToken,
      firstFile: files[0]
        ? {
            id: files[0].id,
            hasUrlPrivateDownload: !!files[0].url_private_download,
            hasUrlPrivate: !!files[0].url_private,
            mimetype: files[0].mimetype,
            filetype: files[0].filetype,
          }
        : null,
    });

    if (botToken && files[0]) {
      try {
        const result = await uploadSlackFile(files[0], botToken, {
          enforceSquare: true,
          maxHeight: 512,
          bucket: env.LOGO_BUCKET_NAME,
        });
        logger.debug("Region logo upload result", {
          success: !!result,
          url: result?.url,
        });
        if (result) {
          logoUrl = result.url;
        }
      } catch (error) {
        logger.error("Region logo upload failed", { error });
      }
    } else {
      logger.warn("Region logo upload skipped - missing bot token or file", {
        hasBotToken: !!botToken,
        hasFile: !!files[0],
      });
    }
  }

  // Fetch current org to get orgType for the update
  const orgResult = await api.org.byId({ id: orgId });
  const orgType = orgResult.org?.orgType ?? "region";

  // Build update fields
  const updateFields: Parameters<typeof api.org.crupdate>[0] = {
    id: orgId,
    orgType,
    name,
    description,
    website,
    email,
    twitter,
    facebook,
    instagram,
  };
  if (logoUrl) {
    updateFields.logoUrl = logoUrl;
  }

  logger.debug("Region update fields", {
    orgId,
    hasLogoUrl: !!logoUrl,
    logoUrl,
    updateFields,
  });

  try {
    await api.org.crupdate(updateFields);
    logger.info(`Updated region info for org ${orgId}`);
  } catch (error) {
    logger.error("Failed to update region info:", error);
  }

  // Handle admin user assignments
  const adminSlackIds =
    (
      values[ACTIONS.REGION_ADMINS]?.[ACTIONS.REGION_ADMINS] as {
        selected_users?: string[];
      }
    )?.selected_users ?? [];

  if (adminSlackIds.length > 0) {
    const resolved = await resolveSlackUsers({
      client: client as unknown as WebClient,
      slackIds: adminSlackIds,
      teamId,
    });

    const adminUserIds = resolved.resolved.map((u) => u.userId);

    if (resolved.failed.length > 0) {
      logger.warn(
        `Failed to resolve some admin users: ${resolved.failed.join(", ")}`,
      );
    }

    try {
      await api.slack.setOrgAdmins({
        orgId,
        userIds: adminUserIds,
        teamId,
      });
      logger.info(`Updated admin list for org ${orgId}`);
    } catch (error) {
      logger.error("Failed to update admin list:", error);
    }
  } else {
    // Empty admin list submitted
    try {
      await api.slack.setOrgAdmins({
        orgId,
        userIds: [],
        teamId,
      });
      logger.info(`Cleared admin list for org ${orgId}`);
    } catch (error) {
      logger.error("Failed to clear admin list:", error);
    }
  }
}

/**
 * Register Region feature handlers
 */
export function registerRegionFeature(app: App) {
  // Open region info form from config menu
  app.action(ACTIONS.REGION_INFO_BUTTON, async (args: TypedActionArgs) => {
    const { ack, context } = args;
    await ack();

    try {
      const navCtx = createNavContext(args);
      await navigateToView(navCtx, () => buildRegionForm(context), {
        showLoading: true,
        loadingTitle: "Loading Region Info",
      });
    } catch (error) {
      logger.error("Failed to open region form:", error);
    }
  });

  // Region edit form submission
  app.view(ACTIONS.REGION_CALLBACK_ID, handleRegionEdit);
}

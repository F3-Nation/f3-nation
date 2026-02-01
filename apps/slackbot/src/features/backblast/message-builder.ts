/**
 * Backblast Message Builder
 *
 * Builds Slack message blocks for posting backblasts to channels.
 * Also provides plain text formatting for storage and email.
 */

import type { ModalView } from "@slack/types";

import { ACTIONS } from "../../constants/actions";
import type { BackblastFormValues } from "./edit-form-types";

/**
 * Format PAX list for display in the message.
 * Combines Q, Co-Qs, regular PAX, non-Slack PAX, and FNGs.
 */
function formatPaxListDisplay(formValues: BackblastFormValues): {
  paxFormatted: string;
  fngFormatted: string;
} {
  const paxParts: string[] = [];

  // Add Slack PAX (Q, CoQs, and PAX combined)
  const allSlackUsers = new Set([
    formValues.q,
    ...formValues.coQs,
    ...formValues.pax,
  ]);
  for (const userId of allSlackUsers) {
    paxParts.push(`<@${userId}>`);
  }

  // Add non-Slack PAX
  if (formValues.nonSlackPax.trim()) {
    const nonSlackNames = formValues.nonSlackPax
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s);
    paxParts.push(...nonSlackNames);
  }

  const paxFormatted = paxParts.length > 0 ? paxParts.join(", ") : "None";

  // Format FNGs separately
  const fngFormatted = formValues.fngs.trim() || "None";

  return { paxFormatted, fngFormatted };
}

/**
 * Format Co-Qs for display.
 */
function formatCoQsDisplay(coQs: string[]): string {
  if (coQs.length === 0) return "";
  return coQs.map((id) => `<@${id}>`).join(" ");
}

/**
 * Build the backblast message blocks for Slack.
 */
export function buildBackblastMessage(
  formValues: BackblastFormValues,
  aoName: string,
  eventDate: string,
  eventTypeId: number | undefined,
  paxCount: number,
  fngCount: number,
  moleskinePlainText: string,
  eventInstanceId: number,
  excludeFromPaxVault: boolean,
  stravaEnabled: boolean,
): { blocks: ModalView["blocks"]; plainText: string } {
  const { paxFormatted, fngFormatted } = formatPaxListDisplay(formValues);
  const coQsFormatted = formatCoQsDisplay(formValues.coQs);
  const coQsLine = coQsFormatted ? ` ${coQsFormatted}` : "";

  // Build the header text
  const headerText = `*Backblast! ${formValues.title}*
*DATE*: ${eventDate}
*AO*: ${aoName}
*Q*: <@${formValues.q}>${coQsLine}
*PAX*: ${paxFormatted}
*FNGs*: ${fngFormatted}
*COUNT*: ${paxCount}`;

  const blocks: ModalView["blocks"] = [];

  // Header section with event details
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: headerText,
    },
  });

  // Moleskine content (rich text)
  if (
    formValues.moleskine &&
    typeof formValues.moleskine === "object" &&
    "elements" in formValues.moleskine
  ) {
    blocks.push({
      type: "rich_text",
      elements: (formValues.moleskine as { elements: unknown[] }).elements,
    } as ModalView["blocks"][number]);
  }

  // Add file images if present
  for (const fileUrl of formValues.files) {
    blocks.push({
      type: "image",
      image_url: fileUrl,
      alt_text: "Backblast Image",
    });
  }

  // Action buttons
  const buttons: {
    type: "button";
    text: { type: "plain_text"; text: string; emoji?: boolean };
    action_id: string;
    value?: string;
    style?: "primary" | "danger";
  }[] = [
    {
      type: "button",
      text: {
        type: "plain_text",
        text: ":pencil: Edit this backblast",
        emoji: true,
      },
      action_id: ACTIONS.BACKBLAST_EDIT_BUTTON,
      value: JSON.stringify({
        event_instance_id: eventInstanceId,
        original_poster: formValues.q, // Will be updated with actual poster
        q: formValues.q,
        coQs: formValues.coQs,
        files: formValues.files,
      }),
    },
    {
      type: "button",
      text: {
        type: "plain_text",
        text: ":heavy_plus_sign: New backblast",
        emoji: true,
      },
      action_id: ACTIONS.BACKBLAST_NEW_BUTTON,
      value: "new",
    },
  ];

  // Add Strava button if enabled
  if (stravaEnabled) {
    buttons.push({
      type: "button",
      text: { type: "plain_text", text: ":runner: Log to Strava", emoji: true },
      action_id: ACTIONS.BACKBLAST_STRAVA_BUTTON,
      value: String(eventInstanceId),
    });
  }

  blocks.push({
    type: "actions",
    elements: buttons,
  });

  // Add exclude from PAX vault notice if applicable
  if (excludeFromPaxVault) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_This backblast is excluded from PAX Vault stats._",
        },
      ],
    });
  }

  // Build plain text version for storage
  const plainText = buildBackblastPlainText(
    formValues,
    aoName,
    eventDate,
    paxCount,
    moleskinePlainText,
  );

  return { blocks, plainText };
}

/**
 * Build plain text version of the backblast for storage and email.
 */
export function buildBackblastPlainText(
  formValues: BackblastFormValues,
  aoName: string,
  eventDate: string,
  paxCount: number,
  moleskinePlainText: string,
): string {
  // For plain text, we need to convert Slack IDs to names
  // This is a simplified version - the actual names would be resolved elsewhere
  const paxNames: string[] = [];

  // Note: In a full implementation, we'd resolve these to actual names
  // For now, we'll use the Slack ID format
  const allSlackUsers = new Set([
    formValues.q,
    ...formValues.coQs,
    ...formValues.pax,
  ]);
  for (const userId of allSlackUsers) {
    paxNames.push(`@${userId}`);
  }

  // Add non-Slack PAX
  if (formValues.nonSlackPax.trim()) {
    const nonSlackNames = formValues.nonSlackPax
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s);
    paxNames.push(...nonSlackNames);
  }

  const paxFormatted = paxNames.join(", ");
  const fngFormatted = formValues.fngs.trim() || "None";
  const coQsFormatted =
    formValues.coQs.length > 0
      ? formValues.coQs.map((id) => `@${id}`).join(", ")
      : "";
  const coQsLine = coQsFormatted ? ` / Co-Q: ${coQsFormatted}` : "";

  return `Backblast! ${formValues.title}
Date: ${eventDate}
AO: ${aoName}
Q: @${formValues.q}${coQsLine}
PAX: ${paxFormatted}
FNGs: ${fngFormatted}
COUNT: ${paxCount}
${moleskinePlainText}`;
}

/**
 * Build blocks for the "New Backblast" posted message action.
 * This is used when a user clicks the "New Backblast" button on an existing backblast.
 */
export function buildNewBackblastPromptBlocks(
  _eventInstanceId: number,
): ModalView["blocks"] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Would you like to create a new backblast?",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Create New Backblast",
            emoji: true,
          },
          action_id: ACTIONS.BACKBLAST_NEW_BUTTON,
          value: "new",
          style: "primary",
        },
      ],
    },
  ];
}

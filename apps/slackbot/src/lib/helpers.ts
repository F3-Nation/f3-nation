/**
 * Slack Rich Text and Message Helper Functions
 *
 * Utilities for parsing Slack rich text blocks and handling
 * user/channel ID replacements in messages.
 */

import type { WebClient } from "@slack/web-api";
import { logger } from "./logger";

/**
 * Type definitions for Slack rich text block elements
 */
interface RichTextElement {
  type: string;
  elements?: RichTextSubElement[];
  style?: "ordered" | "bullet";
}

interface RichTextSubElement {
  type: string;
  text?: string;
  name?: string;
  url?: string;
  user_id?: string;
  channel_id?: string;
  elements?: RichTextSubElement[];
}

interface RichTextBlock {
  type?: string;
  elements?: RichTextElement[];
}

/**
 * Process a single text element from a rich text block
 */
function processTextElement(
  text: RichTextSubElement,
  elementType: string,
): string {
  let msg = "";

  // Add quote prefix if in a quote block
  if (elementType === "rich_text_quote") {
    msg += '"';
  }

  switch (text.type) {
    case "text":
      msg += text.text ?? "";
      break;
    case "emoji":
      msg += `:${text.name}:`;
      break;
    case "link":
      msg += text.url ?? "";
      break;
    case "user":
      msg += `<@${text.user_id}>`;
      break;
    case "channel":
      msg += `<#${text.channel_id}>`;
      break;
    default:
      // Unknown element type, skip
      break;
  }

  // Close quote if in a quote block
  if (elementType === "rich_text_quote") {
    msg += '"';
  }

  return msg;
}

/**
 * Parse a Slack rich text block into plain text.
 *
 * Extracts the text content from a rich_text block, preserving:
 * - User mentions as <@USER_ID>
 * - Channel mentions as <#CHANNEL_ID>
 * - Emoji as :emoji_name:
 * - Links as URLs
 * - Lists (ordered and unordered)
 *
 * @param block - The rich text block to parse
 * @returns Plain text representation of the block
 */
export function parseRichBlock(
  block: RichTextBlock | null | undefined,
): string {
  if (!block?.elements) {
    return "";
  }

  let msg = "";

  for (const element of block.elements) {
    const elementType = element.type;

    if (
      elementType === "rich_text_section" ||
      elementType === "rich_text_preformatted" ||
      elementType === "rich_text_quote"
    ) {
      for (const text of element.elements ?? []) {
        msg += processTextElement(text, elementType);
      }
    } else if (elementType === "rich_text_list") {
      const isOrdered = element.style === "ordered";

      for (let i = 0; i < (element.elements?.length ?? 0); i++) {
        const item = element.elements![i]!;
        let lineMsg = "";

        for (const text of item.elements ?? []) {
          lineMsg += processTextElement(text, item.type);
        }

        const lineStart = isOrdered ? `${i + 1}. ` : "- ";
        msg += `${lineStart}${lineMsg}\n`;
      }
    }
  }

  return msg;
}

/**
 * Get user display names from Slack IDs.
 *
 * @param slackUserIds - Array of Slack user IDs
 * @param client - Slack WebClient
 * @param returnUrls - If true, also return avatar URLs
 * @returns Array of display names (and optionally URLs)
 */
export async function getUserNames(
  slackUserIds: string[],
  client: WebClient,
): Promise<string[]> {
  const names: string[] = [];

  for (const userId of slackUserIds) {
    try {
      const userInfo = await client.users.info({ user: userId });
      // Using ?? - empty strings should also fall back
      const displayName =
        userInfo.user?.profile?.display_name ??
        userInfo.user?.profile?.real_name ??
        userInfo.user?.name ??
        "Unknown";
      names.push(displayName);
    } catch (error) {
      logger.warn(`Failed to get user info for ${userId}`, error);
      names.push("Unknown");
    }
  }

  return names;
}

/**
 * Get channel names from Slack channel IDs.
 *
 * @param channelIds - Array of Slack channel IDs
 * @param client - Slack WebClient
 * @returns Array of channel names
 */
export async function getChannelNames(
  channelIds: string[],
  client: WebClient,
): Promise<string[]> {
  const names: string[] = [];

  for (const channelId of channelIds) {
    try {
      const channelInfo = await client.conversations.info({
        channel: channelId,
      });
      const channelName = channelInfo.channel?.name ?? "unknown-channel";
      names.push(channelName);
    } catch (error) {
      logger.warn(`Failed to get channel info for ${channelId}`, error);
      names.push("unknown-channel");
    }
  }

  return names;
}

/**
 * Replace Slack user and channel IDs with their display names.
 *
 * Converts text like "<@U12345>" to "@username" and "<#C12345>" to "#channel-name".
 * This is useful for storing plain text versions of rich text content.
 *
 * @param text - Text containing Slack IDs
 * @param client - Slack WebClient
 * @returns Text with IDs replaced by names
 */
export async function replaceUserChannelIds(
  text: string,
  client: WebClient,
): Promise<string> {
  if (!text) return "";

  // Pattern to match user mentions: <@U12345>
  const userPattern = /<@([A-Z0-9]+)>/g;
  // Pattern to match channel mentions: <#C12345> or <#C12345|channel-name>
  const channelPattern = /<#([A-Z0-9]+)(?:\|[A-Za-z\d-]+)?>/g;

  // Find all user IDs
  const userMatches = [...text.matchAll(userPattern)];
  const userIds = userMatches.map((m) => m[1]!);

  // Find all channel IDs
  const channelMatches = [...text.matchAll(channelPattern)];
  const channelIds = channelMatches.map((m) => m[1]!);

  // Get names for users and channels
  const userNames =
    userIds.length > 0 ? await getUserNames(userIds, client) : [];
  const channelNames =
    channelIds.length > 0 ? await getChannelNames(channelIds, client) : [];

  // Replace user mentions
  let result = text;
  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i]!;
    const userName = userNames[i] ?? "Unknown";
    result = result.replace(`<@${userId}>`, `@${userName}`);
  }

  // Replace channel mentions (handle both <#ID> and <#ID|name> formats)
  for (let i = 0; i < channelIds.length; i++) {
    const channelId = channelIds[i]!;
    const channelName = channelNames[i] ?? "unknown-channel";
    // Replace both formats
    result = result.replace(
      new RegExp(`<#${channelId}(?:\\|[A-Za-z\\d-]+)?>`, "g"),
      `#${channelName}`,
    );
  }

  return result;
}

/**
 * Convert plain text to a rich text block structure.
 *
 * Creates a simple rich text block from plain text.
 * Handles bold text (*text*) and emojis (:emoji:).
 *
 * @param text - Plain text to convert
 * @returns Rich text block structure
 */
export function plainTextToRichBlock(text: string): RichTextBlock {
  // Split out bolded text using *
  const splitText = text.split(/(\*.*?\*)/);
  const textElements: RichTextSubElement[] = [];

  for (const segment of splitText) {
    if (segment.startsWith("*") && segment.endsWith("*")) {
      // Bold text
      const innerText = segment.slice(1, -1);
      // Further split for emojis within bold text
      const emojiSplit = innerText.split(/(:\S*?:)/);
      for (const part of emojiSplit) {
        if (part.startsWith(":") && part.endsWith(":")) {
          textElements.push({
            type: "emoji",
            name: part.slice(1, -1),
          });
        } else if (part) {
          textElements.push({
            type: "text",
            text: part,
            // Note: Slack rich text uses style object, but we simplify here
          });
        }
      }
    } else if (segment) {
      // Normal text - check for emojis
      const emojiSplit = segment.split(/(:\S*?:)/);
      for (const part of emojiSplit) {
        if (part.startsWith(":") && part.endsWith(":")) {
          textElements.push({
            type: "emoji",
            name: part.slice(1, -1),
          });
        } else if (part) {
          textElements.push({
            type: "text",
            text: part,
          });
        }
      }
    }
  }

  return {
    type: "rich_text",
    elements: [
      {
        type: "rich_text_section",
        elements: textElements,
      },
    ],
  };
}

/**
 * Get display name for a location.
 *
 * Returns the best available name for a location in order of preference:
 * 1. Location name
 * 2. First 30 chars of description
 * 3. First 30 chars of street address
 * 4. "Unnamed Location"
 */
export function getLocationDisplayName(location: {
  name?: string | null;
  locationName?: string | null;
  description?: string | null;
  addressStreet?: string | null;
}): string {
  const name = location.name ?? location.locationName;
  if (name && name.trim() !== "") {
    return name;
  }
  if (location.description && location.description.trim() !== "") {
    return location.description.slice(0, 30);
  }
  if (location.addressStreet && location.addressStreet.trim() !== "") {
    return location.addressStreet.slice(0, 30);
  }
  return "Unnamed Location";
}

/**
 * Format a date string for display.
 * Converts YYYY-MM-DD to a readable format like "Saturday, January 25"
 */
export function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
  };
  return date.toLocaleDateString("en-US", options);
}

/**
 * Format a time string for display.
 * Converts HHMM or HH:MM to "H:MM AM/PM" format.
 */
export function formatTimeDisplay(timeStr: string | null): string {
  if (!timeStr) return "";
  // Handle both HHMM and HH:MM formats
  const normalized = timeStr.replace(":", "");
  if (normalized.length < 4) return timeStr;
  const hours = parseInt(normalized.slice(0, 2), 10);
  const minutes = normalized.slice(2, 4);
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes} ${ampm}`;
}

/**
 * Convert time string to HH:MM format for Slack time picker.
 * Handles both HHMM and HH:MM input formats.
 */
export function normalizeTimeForPicker(timeStr: string | null): string {
  if (!timeStr) return "";
  const normalized = timeStr.replace(":", "");
  if (normalized.length < 4) return timeStr;
  return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}`;
}

/**
 * Convert time string from HH:MM to HHMM format for storage.
 */
export function normalizeTimeForStorage(timeStr: string | null): string {
  if (!timeStr) return "";
  return timeStr.replace(":", "");
}

/**
 * Get current date in CST timezone as YYYY-MM-DD string.
 */
export function getCurrentDateCST(): string {
  const now = new Date();
  // CST is UTC-6, CDT is UTC-5
  // For simplicity, use America/Chicago timezone
  const cstDate = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Chicago" }),
  );
  return cstDate.toISOString().split("T")[0]!;
}

/**
 * Safe property accessor similar to Python's safe_get.
 * Safely navigates nested objects/arrays.
 */
export function safeGet<T>(
  data: unknown,
  ...keys: (string | number)[]
): T | null {
  if (data === null || data === undefined) {
    return null;
  }

  let result: unknown = data;

  for (const key of keys) {
    if (result === null || result === undefined) {
      return null;
    }

    if (typeof key === "number" && Array.isArray(result)) {
      if (key >= 0 && key < result.length) {
        result = result[key];
      } else {
        return null;
      }
    } else if (typeof result === "object" && result !== null) {
      result = (result as Record<string, unknown>)[String(key)];
    } else {
      return null;
    }
  }

  return result as T;
}

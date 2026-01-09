/**
 * Message templates for the Slack bot
 * Migrated from Python utilities/constants.py
 */

export const WELCOME_MESSAGE_TEMPLATES = [
  "The man, the myth, the LEGEND, it's <@{user}>! Welcome to {region}! We're glad you're here. Please take a moment to introduce yourself and let us know how we can help you get started. We're looking forward to seeing you in the gloom!",
  "Who's this?!? It's <@{user}>! Welcome to {region}! We're glad you're here. Please take a moment to introduce yourself and let us know how we can help you get started. We're looking forward to seeing you in the gloom!",
  "Hey, it's <@{user}>! Welcome to {region}, we're glad you're here. Please take a moment to introduce yourself and let us know how we can help you get started. We're looking forward to seeing you in the gloom!",
  "Sharkbait, ooh ha ha! It's <@{user}>! Welcome to {region}, we're glad you're here. Please take a moment to introduce yourself and let us know how we can help you get started. We're looking forward to seeing you in the gloom!",
  "Could it be?!? It's <@{user}>! Welcome to {region}, we're glad you're here. Please take a moment to introduce yourself and let us know how we can help you get started. We're looking forward to seeing you in the gloom!",
  "<@{user}> is in the house! Welcome to {region}, we're glad you're here. Please take a moment to introduce yourself and let us know how we can help you get started. We're looking forward to seeing you in the gloom!",
];

export const DEFAULT_BACKBLAST_MOLESKINE_TEMPLATE = {
  type: "rich_text",
  elements: [
    {
      type: "rich_text_section",
      elements: [
        { type: "text", text: "\nWARMUP:", style: { bold: true } },
        { type: "text", text: " \n" },
        { type: "text", text: "THE THANG:", style: { bold: true } },
        { type: "text", text: " \n" },
        { type: "text", text: "MARY:", style: { bold: true } },
        { type: "text", text: " \n" },
        { type: "text", text: "ANNOUNCEMENTS:", style: { bold: true } },
        { type: "text", text: " \n" },
        { type: "text", text: "COT:", style: { bold: true } },
        { type: "text", text: " " },
      ],
    },
  ],
};

export const DEFAULT_PREBLAST_MOLESKINE_TEMPLATE = {
  type: "rich_text",
  elements: [
    {
      type: "rich_text_section",
      elements: [
        { type: "text", text: "\nWHAT:", style: { bold: true } },
        { type: "text", text: " \n" },
        { type: "text", text: "WHY: ", style: { bold: true } },
        { type: "text", text: " " },
      ],
    },
  ],
};

export const ERROR_FORM_MESSAGE_TEMPLATE =
  ":warning: Sorry, the following error occurred:\n\n```{error}```";

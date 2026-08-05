import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { and, eq, schema } from "@acme/db";
import type { AppDb } from "@acme/db/client";

import { checkHasRoleOnOrg } from "../check-has-role-on-org";
import { protectedProcedure } from "../shared";
import type { Context } from "../shared";

type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface SlackMessagePayload {
  channel: string;
  text: string;
  blocks?: Record<string, JsonValue>[];
  metadata?: { event_type: string; event_payload: Record<string, JsonValue> };
  username?: string;
  icon_url?: string;
  mrkdwn?: boolean;
  thread_ts?: string;
  ts?: string;
}

interface SlackWebApiSuccess {
  ok: true;
  channel?: string;
  ts?: string;
}

interface NormalizedSlackWebApiSuccess {
  ok: true;
  channel: string;
  ts: string;
}

interface SlackWebApiFailure {
  ok: false;
  error?: string;
}

type SlackWebApiResponse = SlackWebApiSuccess | SlackWebApiFailure;

// Slack message payloads can become large through blocks/metadata. Keep a
// conservative local cap well below common gateway limits and Slack's practical
// message-size constraints; Slack still performs final Block Kit validation.
const MAX_SLACK_PAYLOAD_BYTES = 128 * 1024;

// Admin-supplied blocks/metadata JSON is recursive, so cap nesting depth to
// prevent excessive recursion or stack overflow on pathological input. Slack's
// own Block Kit rarely exceeds a handful of levels; 32 leaves generous headroom.
const MAX_SLACK_JSON_DEPTH = 32;

const slackTimestampSchema = z
  .string()
  .regex(/^\d{10}\.\d{6}$/, "Must be a Slack message timestamp");

// Depth-bounded recursive JSON validator. Each nested array/record decrements
// the remaining depth budget; once exhausted, only primitives are accepted so
// deeper input is rejected without unbounded recursion.
const createSlackJsonValueSchema = (
  remainingDepth: number,
): z.ZodType<JsonValue> =>
  remainingDepth <= 0
    ? z.union([z.string(), z.number(), z.boolean(), z.null()])
    : z.lazy(() =>
        z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.null(),
          z.array(createSlackJsonValueSchema(remainingDepth - 1)),
          z.record(z.string(), createSlackJsonValueSchema(remainingDepth - 1)),
        ]),
      );

const slackJsonValueSchema: z.ZodType<JsonValue> =
  createSlackJsonValueSchema(MAX_SLACK_JSON_DEPTH);

const slackJsonObjectSchema = z.record(z.string(), slackJsonValueSchema);

const slackMetadataSchema = z
  .object({
    event_type: z
      .string()
      .max(256)
      .refine((value) => value.trim().length > 0, "Required"),
    event_payload: slackJsonObjectSchema,
  })
  .strict();

const baseMessageInputSchema = z
  .object({
    regionOrgId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The F3 org ID of the region to which the Slack bot is linked")
      .min(1),
    slackChannelId: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .describe(
        "The Slack channel, user, or group ID where the message will be posted or updated",
      ),
    text: z
      .string()
      .max(4000)
      .refine((value) => value.trim().length > 0, "Required")
      .describe(
        "The text content of the Slack message. This supports Slack's markdown-like formatting",
      ),
    blocks: z
      .array(slackJsonObjectSchema)
      .max(50)
      .optional()
      .describe(
        "An array of Block Kit blocks to include in the Slack message. Each block must be a valid JSON object according to Slack's Block Kit specification",
      ),
    metadata: slackMetadataSchema
      .optional()
      .describe(
        "Optional metadata for the Slack message, which must include an event_type and event_payload keys. The event type must be a non-empty string, and the event_payload must be a valid JSON object",
      ),
  })
  .strict();

const postSlackMessageInputSchema = baseMessageInputSchema
  .extend({
    username: z
      .string()
      .max(80)
      .refine((value) => value.trim().length > 0, "Required")
      .optional()
      .describe(
        "The username to display as the sender of the Slack message. This is optional and can be used to override the default bot username.",
      ),
    icon_url: z
      .string()
      .url()
      .startsWith("https://")
      .optional()
      .describe(
        "The URL of the icon to display as the sender of the Slack message. This is optional and must be a valid HTTPS URL.",
      ),
    mrkdwn: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Whether to enable Markdown formatting in the Slack message. This is optional and defaults to true.",
      ),
    thread_ts: slackTimestampSchema
      .optional()
      .describe(
        "The timestamp of the parent message to reply to in a thread. This is optional and allows the message to be posted as a threaded reply.",
      ),
  })
  .strict();

const updateSlackMessageInputSchema = baseMessageInputSchema
  .extend({
    ts: slackTimestampSchema,
  })
  .strict();

const slackMessageOutputSchema = z.object({
  ok: z.literal(true),
  action: z.enum(["posted", "updated"]),
  channel: z.string(),
  ts: z.string(),
});

const assertOrgAdmin = async (
  ctx: Pick<Context, "session" | "db">,
  regionOrgId: number,
) => {
  const authResult = await checkHasRoleOnOrg({
    session: ctx.session,
    db: ctx.db,
    orgId: regionOrgId,
    roleName: "admin",
  });

  if (!authResult.success) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Admin access to this org is required",
    });
  }
};

const assertActiveOrgExists = async (db: AppDb, regionOrgId: number) => {
  const [org] = await db
    .select({ id: schema.orgs.id })
    .from(schema.orgs)
    .where(and(eq(schema.orgs.id, regionOrgId), eq(schema.orgs.isActive, true)))
    .limit(1);

  if (!org) {
    throw new ORPCError("NOT_FOUND", {
      message: "Active org not found",
    });
  }
};

const getSlackBotTokenForOrg = async (
  db: AppDb,
  regionOrgId: number,
): Promise<string> => {
  const rows = await db
    .select({
      botToken: schema.slackSpaces.botToken,
    })
    .from(schema.orgsXSlackSpaces)
    .innerJoin(
      schema.slackSpaces,
      eq(schema.orgsXSlackSpaces.slackSpaceId, schema.slackSpaces.id),
    )
    .where(eq(schema.orgsXSlackSpaces.orgId, regionOrgId))
    .limit(2);

  if (rows.length === 0) {
    throw new ORPCError("NOT_FOUND", {
      message:
        "Slack bot is not installed for this region. Follow the instructions at https://slackbotdocs.f3nation.com to install the F3 Nation Slack app for your region!",
    });
  }

  if (rows.length > 1) {
    throw new ORPCError("CONFLICT", {
      message: "Multiple Slack spaces are linked to this region",
    });
  }

  const botToken = rows[0]?.botToken?.trim();
  if (!botToken) {
    throw new ORPCError("NOT_FOUND", {
      message:
        "Slack bot token not found for this region. Please contact the F3 tech team.",
    });
  }

  return botToken;
};

const prepareSlackMessageRequest = async (
  ctx: Pick<Context, "session" | "db">,
  regionOrgId: number,
): Promise<{ botToken: string }> => {
  await assertOrgAdmin(ctx, regionOrgId);
  const [, botToken] = await Promise.all([
    assertActiveOrgExists(ctx.db, regionOrgId),
    getSlackBotTokenForOrg(ctx.db, regionOrgId),
  ]);

  return { botToken };
};

const mapSlackError = (slackError: string) => {
  if (
    ["channel_not_found", "user_not_found", "not_in_channel"].includes(
      slackError,
    )
  ) {
    return new ORPCError("NOT_FOUND", {
      message: `Slack channel/user not found or bot lacks access (${slackError})`,
    });
  }

  if (slackError === "message_not_found") {
    return new ORPCError("NOT_FOUND", {
      message: `Slack message to update was not found (${slackError})`,
    });
  }

  if (slackError === "cant_update_message") {
    return new ORPCError("FORBIDDEN", {
      message: `Slack message cannot be updated by this bot (${slackError})`,
    });
  }

  if (
    [
      "invalid_blocks",
      "invalid_metadata_format",
      "metadata_too_large",
      "msg_too_long",
      "no_text",
    ].includes(slackError)
  ) {
    return new ORPCError("BAD_REQUEST", {
      message: `Invalid Slack message payload (${slackError})`,
    });
  }

  if (["invalid_auth", "not_authed", "missing_scope"].includes(slackError)) {
    return new ORPCError("BAD_GATEWAY", {
      message: `Slack integration is not configured correctly (${slackError})`,
    });
  }

  if (slackError === "ratelimited") {
    return new ORPCError("TOO_MANY_REQUESTS", {
      message: `Slack rate limit exceeded (${slackError})`,
    });
  }

  return new ORPCError("INTERNAL_SERVER_ERROR", {
    message: `Slack API returned an error (${slackError})`,
  });
};

const callSlackWebApi = async ({
  url,
  botToken,
  payload,
}: {
  url: string;
  botToken: string;
  payload: SlackMessagePayload;
}): Promise<NormalizedSlackWebApiSuccess> => {
  let response: Response;
  let body: string;

  try {
    body = JSON.stringify(payload);
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "Slack message payload is not JSON serializable",
    });
  }

  if (new TextEncoder().encode(body).byteLength > MAX_SLACK_PAYLOAD_BYTES) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Slack message payload is limited to ${MAX_SLACK_PAYLOAD_BYTES / 1024} KB in size.`,
    });
  }

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ORPCError("BAD_GATEWAY", {
      message: "Unable to reach Slack API",
    });
  }

  let data: SlackWebApiResponse;
  try {
    data = (await response.json()) as SlackWebApiResponse;
  } catch {
    if (response.status === 429) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "Slack rate limit exceeded",
      });
    }

    if (!response.ok && response.status >= 500) {
      throw new ORPCError("BAD_GATEWAY", {
        message: "Slack API returned a server error",
      });
    }

    throw new ORPCError("BAD_GATEWAY", {
      message:
        "An unexpected error occurred while processing the Slack API response",
    });
  }

  if (!data.ok) {
    throw mapSlackError(data.error ?? "unknown_error");
  }

  if (response.status === 429) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "Slack rate limit exceeded",
    });
  }

  if (!response.ok && response.status >= 500) {
    throw new ORPCError("BAD_GATEWAY", {
      message: "Slack API returned a server error",
    });
  }

  if (!response.ok) {
    throw new ORPCError("BAD_GATEWAY", {
      message: "Slack API request failed",
    });
  }

  const channel = data.channel;
  const ts = data.ts;
  if (!channel || !ts) {
    throw new ORPCError("BAD_GATEWAY", {
      message: "Slack API response is missing message identifiers",
    });
  }

  return {
    ok: true,
    channel,
    ts,
  };
};

export const slackRouter = {
  postMessage: protectedProcedure
    .input(postSlackMessageInputSchema)
    .route({
      method: "POST",
      path: "/message",
      tags: ["slack"],
      summary: "Post a Slack message",
      description:
        "Post a Slack message to a channel, user, or group. Requires admin access on the target org and an active F3 Nation Slack app installation.",
    })
    .output(slackMessageOutputSchema)
    .handler(async ({ context: ctx, input }) => {
      const { botToken } = await prepareSlackMessageRequest(
        ctx,
        input.regionOrgId,
      );
      const response = await callSlackWebApi({
        url: "https://slack.com/api/chat.postMessage",
        botToken,
        payload: {
          channel: input.slackChannelId,
          text: input.text,
          blocks: input.blocks,
          username: input.username,
          icon_url: input.icon_url,
          metadata: input.metadata,
          mrkdwn: input.mrkdwn,
          thread_ts: input.thread_ts,
        },
      });

      return {
        ok: true,
        action: "posted",
        channel: response.channel,
        ts: response.ts,
      };
    }),

  updateMessage: protectedProcedure
    .input(updateSlackMessageInputSchema)
    .route({
      method: "PATCH",
      path: "/message/{ts}",
      tags: ["slack"],
      summary: "Update a Slack message",
      description:
        "Update a Slack message in a channel, user, or group. Requires admin access on the target org and an active F3 Nation Slack app installation.",
    })
    .output(slackMessageOutputSchema)
    .handler(async ({ context: ctx, input }) => {
      const { botToken } = await prepareSlackMessageRequest(
        ctx,
        input.regionOrgId,
      );
      const response = await callSlackWebApi({
        url: "https://slack.com/api/chat.update",
        botToken,
        payload: {
          channel: input.slackChannelId,
          ts: input.ts,
          text: input.text,
          blocks: input.blocks,
          metadata: input.metadata,
        },
      });

      return {
        ok: true,
        action: "updated",
        channel: response.channel,
        ts: response.ts,
      };
    }),
};

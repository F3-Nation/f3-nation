import { afterEach, describe, expect, it, vi } from "vitest";
import { createRouterClient } from "@orpc/server";

import type { Session } from "@acme/auth";
import { eq, schema } from "@acme/db";
import { Client, Header } from "@acme/shared/common/enums";

import {
  cleanup,
  createTestClient,
  db,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";
import { router } from "../index";
import {
  callSlackWebApi,
  postSlackMessageInputSchema,
  updateSlackMessageInputSchema,
} from "./slack";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Slack router schemas", () => {
  const baseInput = {
    regionOrgId: 1,
    slackChannelId: "C123",
    text: "hello",
  };

  it("rejects unknown post/update fields", () => {
    expect(
      postSlackMessageInputSchema.safeParse({ ...baseInput, extra: true })
        .success,
    ).toBe(false);
    expect(
      updateSlackMessageInputSchema.safeParse({
        ...baseInput,
        ts: "1712345678.123456",
        username: "not allowed",
      }).success,
    ).toBe(false);
  });

  it("validates text without trimming it", () => {
    const parsed = postSlackMessageInputSchema.parse({
      ...baseInput,
      text: "  hello  ",
    });

    expect(parsed.text).toBe("  hello  ");
    expect(
      postSlackMessageInputSchema.safeParse({ ...baseInput, text: "   " })
        .success,
    ).toBe(false);
    expect(
      postSlackMessageInputSchema.safeParse({
        ...baseInput,
        text: "x".repeat(4001),
      }).success,
    ).toBe(false);
  });

  it("enforces JSON-safe blocks and max block count", () => {
    expect(
      postSlackMessageInputSchema.safeParse({
        ...baseInput,
        blocks: Array.from({ length: 51 }, () => ({ type: "section" })),
      }).success,
    ).toBe(false);
    expect(
      postSlackMessageInputSchema.safeParse({
        ...baseInput,
        blocks: [{ type: "section", text: undefined }],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown metadata fields and non-JSON payload values", () => {
    expect(
      postSlackMessageInputSchema.safeParse({
        ...baseInput,
        metadata: {
          event_type: "f3.event",
          event_payload: { id: 1 },
          extra: true,
        },
      }).success,
    ).toBe(false);
    expect(
      postSlackMessageInputSchema.safeParse({
        ...baseInput,
        metadata: {
          event_type: "f3.event",
          event_payload: { when: new Date() },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects deeply nested blocks beyond the depth cap", () => {
    // Build a payload nested deeper than MAX_SLACK_JSON_DEPTH by wrapping an
    // object under a single key repeatedly.
    let nested: Record<string, unknown> = { leaf: "value" };
    for (let i = 0; i < 40; i++) {
      nested = { nested };
    }

    expect(
      postSlackMessageInputSchema.safeParse({
        ...baseInput,
        blocks: [nested],
      }).success,
    ).toBe(false);

    expect(
      postSlackMessageInputSchema.safeParse({
        ...baseInput,
        metadata: {
          event_type: "f3.event",
          event_payload: nested,
        },
      }).success,
    ).toBe(false);
  });
});

describe("callSlackWebApi", () => {
  it("posts JSON payloads with the bot token header and normalizes success", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, channel: "C123", ts: "1712345678.123456" }),
        {
          status: 200,
        },
      ),
    );

    const result = await callSlackWebApi({
      url: "https://slack.com/api/chat.postMessage",
      botToken: "xoxb-secret-token",
      payload: { channel: "C123", text: "hello" },
    });

    expect(result).toEqual({
      ok: true,
      channel: "C123",
      ts: "1712345678.123456",
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(init?.method).toBe("POST");
    expect(headers?.Authorization).toBe("Bearer xoxb-secret-token");
    expect(headers?.["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(init?.body).toBe(JSON.stringify({ channel: "C123", text: "hello" }));
  });

  it.each([
    ["channel_not_found", "NOT_FOUND", 200],
    ["message_not_found", "NOT_FOUND", 200],
    ["cant_update_message", "FORBIDDEN", 200],
    ["invalid_blocks", "BAD_REQUEST", 200],
    ["invalid_metadata_format", "BAD_REQUEST", 200],
    ["metadata_too_large", "BAD_REQUEST", 200],
    ["invalid_auth", "BAD_GATEWAY", 200],
    ["missing_scope", "BAD_GATEWAY", 200],
    ["ratelimited", "TOO_MANY_REQUESTS", 200],
    ["invalid_blocks", "BAD_REQUEST", 400],
  ])("maps Slack error %s to %s", async (slackError, code, status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: slackError }), {
        status,
      }),
    );

    let thrown: unknown;
    try {
      await callSlackWebApi({
        url: "https://slack.com/api/chat.postMessage",
        botToken: "xoxb-secret-token",
        payload: { channel: "C123", text: "hello" },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code });
    expect(JSON.stringify(thrown)).not.toContain("xoxb-secret-token");
  });

  it.each([
    [new Response("", { status: 429 }), "TOO_MANY_REQUESTS"],
    [new Response("", { status: 500 }), "BAD_GATEWAY"],
    [new Response("not json", { status: 200 }), "BAD_GATEWAY"],
    [
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
      "BAD_GATEWAY",
    ],
  ])("maps HTTP/response failures", async (response, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);

    await expect(
      callSlackWebApi({
        url: "https://slack.com/api/chat.postMessage",
        botToken: "xoxb-secret-token",
        payload: { channel: "C123", text: "hello" },
      }),
    ).rejects.toMatchObject({ code });
  });

  it("maps network failures and oversized payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("boom"));
    await expect(
      callSlackWebApi({
        url: "https://slack.com/api/chat.postMessage",
        botToken: "xoxb-secret-token",
        payload: { channel: "C123", text: "hello" },
      }),
    ).rejects.toMatchObject({ code: "BAD_GATEWAY" });

    await expect(
      callSlackWebApi({
        url: "https://slack.com/api/chat.postMessage",
        botToken: "xoxb-secret-token",
        payload: { channel: "C123", text: "x".repeat(130 * 1024) },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("maps JSON serialization failures without leaking bot tokens", async () => {
    const circular: Record<string, unknown> = {
      channel: "C123",
      text: "hello",
    };
    circular.self = circular;

    let thrown: unknown;
    try {
      await callSlackWebApi({
        url: "https://slack.com/api/chat.postMessage",
        botToken: "xoxb-secret-token",
        payload: circular as unknown as Parameters<
          typeof callSlackWebApi
        >[0]["payload"],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "BAD_REQUEST" });
    expect(JSON.stringify(thrown)).not.toContain("xoxb-secret-token");
  });
});

describe("mounted Slack router", () => {
  const createOrgWithSlack = async ({
    isActive = true,
    botToken = "xoxb-secret-token",
    duplicate = false,
  } = {}) => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: `Slack Org ${suffix}`, orgType: "region", isActive })
      .returning({ id: schema.orgs.id, name: schema.orgs.name });
    if (!org) throw new Error("org insert failed");

    const insertSpace = async (teamId: string) => {
      const [space] = await db
        .insert(schema.slackSpaces)
        .values({ teamId, workspaceName: teamId, botToken })
        .returning({ id: schema.slackSpaces.id });
      if (!space) throw new Error("space insert failed");
      await db
        .insert(schema.orgsXSlackSpaces)
        .values({ orgId: org.id, slackSpaceId: space.id });
      return space.id;
    };

    const spaceIds = [await insertSpace(`T${suffix}`)];
    if (duplicate) spaceIds.push(await insertSpace(`T2${suffix}`));

    return { org, spaceIds };
  };

  const cleanupSlack = async (orgId: number, spaceIds: number[]) => {
    await db
      .delete(schema.orgsXSlackSpaces)
      .where(eq(schema.orgsXSlackSpaces.orgId, orgId));
    for (const id of spaceIds) {
      await db.delete(schema.slackSpaces).where(eq(schema.slackSpaces.id, id));
    }
    await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
  };

  const adminSessionForOrg = (org: { id: number; name: string }): Session => ({
    id: 1,
    email: "admin@example.com",
    user: { id: "1", email: "admin@example.com", roles: [], name: "Admin" },
    roles: [{ orgId: org.id, orgName: org.name, roleName: "admin" }],
    expires: new Date(Date.now() + 1000).toISOString(),
  });

  it("posts with target-org admin, post-only fields, and normalized output", async () => {
    const { org, spaceIds } = await createOrgWithSlack();
    try {
      await mockAuthWithSession(adminSessionForOrg(org));
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            channel: "C123",
            ts: "1712345678.123456",
          }),
        ),
      );

      const result = await createTestClient().slack.postMessage({
        regionOrgId: org.id,
        slackChannelId: "C123",
        text: "hello",
        username: "F3",
        mrkdwn: true,
        thread_ts: "1712345678.123456",
      });

      expect(result).toEqual({
        ok: true,
        action: "posted",
        channel: "C123",
        ts: "1712345678.123456",
      });
      const requestBody = fetchMock.mock.calls[0]?.[1]?.body as string;
      const body = JSON.parse(requestBody) as Record<string, unknown>;
      expect(body.username).toBe("F3");
      expect(body.mrkdwn).toBe(true);
      expect(body.thread_ts).toBe("1712345678.123456");
    } finally {
      await cleanupSlack(org.id, spaceIds);
    }
  });

  it("updates without post-only fields", async () => {
    const { org, spaceIds } = await createOrgWithSlack();
    try {
      await mockAuthWithSession(adminSessionForOrg(org));
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            channel: "C123",
            ts: "1712345678.123456",
          }),
        ),
      );
      await createTestClient().slack.updateMessage({
        regionOrgId: org.id,
        slackChannelId: "C123",
        text: "hello",
        ts: "1712345678.123456",
      });
      const requestBody = fetchMock.mock.calls[0]?.[1]?.body as string;
      const body = JSON.parse(requestBody) as Record<string, unknown>;
      expect(body).not.toHaveProperty("username");
      expect(body).not.toHaveProperty("thread_ts");
    } finally {
      await cleanupSlack(org.id, spaceIds);
    }
  });

  it.each([
    ["editor", "UNAUTHORIZED"],
    ["unrelated admin", "UNAUTHORIZED"],
  ])("rejects %s", async (mode, code) => {
    const { org, spaceIds } = await createOrgWithSlack();
    try {
      await mockAuthWithSession({
        id: 1,
        email: "user@example.com",
        user: { id: "1", email: "user@example.com", roles: [], name: "User" },
        roles: [
          {
            orgId: mode === "editor" ? org.id : org.id + 9999,
            orgName: "Other",
            roleName: mode === "editor" ? "editor" : ("admin" as const),
          },
        ],
        expires: new Date(Date.now() + 1000).toISOString(),
      });

      await expect(
        createTestClient().slack.postMessage({
          regionOrgId: org.id,
          slackChannelId: "C123",
          text: "hello",
        }),
      ).rejects.toMatchObject({ code });
    } finally {
      await cleanupSlack(org.id, spaceIds);
    }
  });

  it.each([
    ["inactive org", { isActive: false }, "NOT_FOUND"],
    ["duplicate Slack mapping", { duplicate: true }, "CONFLICT"],
    ["blank bot token", { botToken: "   " }, "NOT_FOUND"],
  ])("rejects %s", async (_name, options, code) => {
    const { org, spaceIds } = await createOrgWithSlack(options);
    try {
      await mockAuthWithSession(adminSessionForOrg(org));

      await expect(
        createTestClient().slack.postMessage({
          regionOrgId: org.id,
          slackChannelId: "C123",
          text: "hello",
        }),
      ).rejects.toMatchObject({ code });
    } finally {
      await cleanupSlack(org.id, spaceIds);
    }
  });

  it("rejects org without Slack mapping", async () => {
    const { org, spaceIds } = await createOrgWithSlack();
    try {
      await db
        .delete(schema.orgsXSlackSpaces)
        .where(eq(schema.orgsXSlackSpaces.orgId, org.id));
      await mockAuthWithSession(adminSessionForOrg(org));

      await expect(
        createTestClient().slack.postMessage({
          regionOrgId: org.id,
          slackChannelId: "C123",
          text: "hello",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await cleanupSlack(org.id, spaceIds);
    }
  });

  it("accepts API key auth with target-org admin role", async () => {
    const { org, spaceIds } = await createOrgWithSlack();
    let apiKeyId: number | undefined;
    try {
      await mockAuthWithSession(adminSessionForOrg(org));
      const apiKey = await createTestClient().apiKey.create({
        name: `Slack API Key ${uniqueId()}`,
        roles: [{ orgId: org.id, roleName: "admin" }],
      });
      apiKeyId = apiKey.id;
      await mockAuthWithSession(null);

      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            channel: "C123",
            ts: "1712345678.123456",
          }),
        ),
      );
      const client = createRouterClient(router, {
        context: () => ({
          reqHeaders: new Headers({
            [Header.Authorization]: `Bearer ${apiKey.secret}`,
            [Header.Client]: Client.ORPC,
          }),
        }),
      });

      const result = await client.slack.postMessage({
        regionOrgId: org.id,
        slackChannelId: "C123",
        text: "hello from api key",
      });

      expect(result).toEqual({
        ok: true,
        action: "posted",
        channel: "C123",
        ts: "1712345678.123456",
      });
      const requestBody = fetchMock.mock.calls[0]?.[1]?.body as string;
      const body = JSON.parse(requestBody) as Record<string, unknown>;
      expect(body.channel).toBe("C123");
      expect(body.text).toBe("hello from api key");
    } finally {
      if (apiKeyId) await cleanup.apiKey(apiKeyId);
      await cleanupSlack(org.id, spaceIds);
    }
  });
});

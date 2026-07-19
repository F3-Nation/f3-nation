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
  slackSettingsPatchSchema,
  updateSlackMessageInputSchema,
} from "./slack";

afterEach(() => {
  vi.restoreAllMocks();
});

const SLACKBOT_SERVICE_API_KEY_ENV = "SLACKBOT_SERVICE_API_KEY";

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
    settings = {},
    parentId,
    orgType = "region",
  }: {
    isActive?: boolean;
    botToken?: string;
    duplicate?: boolean;
    settings?: Record<string, unknown>;
    parentId?: number;
    orgType?: "region" | "ao" | "nation";
  } = {}) => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const [org] = await db
      .insert(schema.orgs)
      .values({ name: `Slack Org ${suffix}`, orgType, isActive, parentId })
      .returning({ id: schema.orgs.id, name: schema.orgs.name });
    if (!org) throw new Error("org insert failed");

    const insertSpace = async (teamId: string) => {
      const [space] = await db
        .insert(schema.slackSpaces)
        .values({ teamId, workspaceName: teamId, botToken, settings })
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

  const serviceClient = (
    key?: string,
    extraHeaders: Record<string, string> = {},
  ) =>
    createRouterClient(router, {
      context: () => ({
        reqHeaders: new Headers({
          ...(key ? { "x-slackbot-service-key": key } : {}),
          ...extraHeaders,
        }),
      }),
    });

  describe("bot settings", () => {
    it("returns raw Python-compatible cache records only with service auth", async () => {
      const previous = process.env[SLACKBOT_SERVICE_API_KEY_ENV];
      process.env[SLACKBOT_SERVICE_API_KEY_ENV] = "service-secret";
      const { org, spaceIds } = await createOrgWithSlack({
        botToken: "xoxb-raw-secret",
        settings: {
          bot_token: "legacy-secret",
          email_password: "pw",
          editing_locked: true,
        },
      });
      let apiKeyId: number | undefined;
      try {
        const result =
          await serviceClient("service-secret").slack.getBotSettingsCache();
        const record = result.find((row) => row.org_id === org.id);
        expect(record?.team_id).toEqual(expect.any(String) as string);
        expect(record?.workspace_name).toEqual(expect.any(String) as string);
        expect(record).toMatchObject({
          org_id: org.id,
          db_id: spaceIds[0],
          bot_token: "xoxb-raw-secret",
        });
        expect(record?.settings).toMatchObject({
          bot_token: "legacy-secret",
          email_password: "pw",
        });

        await expect(
          serviceClient().slack.getBotSettingsCache(),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        await expect(
          serviceClient("wrong").slack.getBotSettingsCache(),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        process.env[SLACKBOT_SERVICE_API_KEY_ENV] = "";
        await expect(
          serviceClient("service-secret").slack.getBotSettingsCache(),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        process.env[SLACKBOT_SERVICE_API_KEY_ENV] = "service-secret";

        await mockAuthWithSession(null);
        await expect(
          serviceClient().slack.getBotSettingsCache(),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        await mockAuthWithSession(adminSessionForOrg(org));
        await expect(
          serviceClient().slack.getBotSettingsCache(),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        await mockAuthWithSession({
          ...adminSessionForOrg({ id: 1, name: "F3 Nation" }),
          roles: [{ orgId: 1, orgName: "F3 Nation", roleName: "admin" }],
        });
        await expect(
          serviceClient().slack.getBotSettingsCache(),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
        await expect(
          serviceClient(undefined, {
            "x-api-key": "super-admin",
          }).slack.getBotSettingsCache(),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

        await mockAuthWithSession(adminSessionForOrg(org));
        const apiKey = await createTestClient().apiKey.create({
          name: `Slack Cache API Key ${uniqueId()}`,
          roles: [{ orgId: org.id, roleName: "admin" }],
        });
        apiKeyId = apiKey.id;
        await mockAuthWithSession(null);
        await expect(
          serviceClient(undefined, {
            [Header.Authorization]: `Bearer ${apiKey.secret}`,
            [Header.Client]: Client.ORPC,
          }).slack.getBotSettingsCache(),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      } finally {
        if (apiKeyId) await cleanup.apiKey(apiKeyId);
        if (previous === undefined)
          delete process.env[SLACKBOT_SERVICE_API_KEY_ENV];
        else process.env[SLACKBOT_SERVICE_API_KEY_ENV] = previous;
        await cleanupSlack(org.id, spaceIds);
      }
    });

    it("admin GET returns full raw settings and enforces mapping semantics", async () => {
      const { org, spaceIds } = await createOrgWithSlack({
        settings: {
          bot_token: "secret",
          email_password: "pw",
          editing_locked: 1,
          strava_enabled: 0,
          automated_preblast_option: "q_only",
          hc_announce_option: "snarky",
          hc_announce_targets: "both",
          bot_log_channel: 123,
        },
      });
      try {
        await mockAuthWithSession(adminSessionForOrg(org));
        const result = await createTestClient().slack.getBotSettings({
          regionOrgId: org.id,
        });
        expect(result.settings).toMatchObject({
          bot_token: "secret",
          email_password: "pw",
          editing_locked: 1,
          strava_enabled: 0,
          automated_preblast_option: "q_only",
          hc_announce_option: "snarky",
          hc_announce_targets: "both",
          bot_log_channel: 123,
        });

        await db
          .delete(schema.orgsXSlackSpaces)
          .where(eq(schema.orgsXSlackSpaces.orgId, org.id));
        await expect(
          createTestClient().slack.getBotSettings({ regionOrgId: org.id }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      } finally {
        await cleanupSlack(org.id, spaceIds);
      }

      const duplicate = await createOrgWithSlack({ duplicate: true });
      try {
        await mockAuthWithSession(adminSessionForOrg(duplicate.org));
        await expect(
          createTestClient().slack.getBotSettings({
            regionOrgId: duplicate.org.id,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      } finally {
        await cleanupSlack(duplicate.org.id, duplicate.spaceIds);
      }

      for (const options of [{ isActive: false }, { orgType: "ao" as const }]) {
        const invalid = await createOrgWithSlack(options);
        try {
          await mockAuthWithSession(adminSessionForOrg(invalid.org));
          await expect(
            createTestClient().slack.getBotSettings({
              regionOrgId: invalid.org.id,
            }),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
        } finally {
          await cleanupSlack(invalid.org.id, invalid.spaceIds);
        }
      }
    });

    it("PATCH accepts bounded raw JSON, syncs columns, preserves keys, and supports null clears", async () => {
      let nested: Record<string, unknown> = { leaf: "value" };
      for (let i = 0; i < 40; i++) nested = { nested };

      expect(slackSettingsPatchSchema.safeParse({}).success).toBe(false);
      expect(slackSettingsPatchSchema.safeParse([]).success).toBe(false);
      expect(slackSettingsPatchSchema.safeParse(null).success).toBe(false);
      expect(slackSettingsPatchSchema.safeParse("scalar").success).toBe(false);
      expect(
        slackSettingsPatchSchema.safeParse({ unknown_key: true }).success,
      ).toBe(true);
      expect(
        slackSettingsPatchSchema.safeParse({ bot_token: "secret" }).success,
      ).toBe(true);
      expect(
        slackSettingsPatchSchema.safeParse({ non_json: new Date() }).success,
      ).toBe(false);
      expect(
        slackSettingsPatchSchema.safeParse({ huge: "x".repeat(129 * 1024) })
          .success,
      ).toBe(false);
      expect(slackSettingsPatchSchema.safeParse({ nested }).success).toBe(
        false,
      );
      expect(
        slackSettingsPatchSchema.safeParse({ team_id: null }).success,
      ).toBe(false);

      const { org, spaceIds } = await createOrgWithSlack({
        settings: {
          bot_token: "secret",
          unknown_legacy: "keep",
          bot_log_channel: "CLOG",
        },
      });
      try {
        await mockAuthWithSession(adminSessionForOrg(org));
        await db
          .update(schema.slackSpaces)
          .set({ updated: "2000-01-01 00:00:00" })
          .where(eq(schema.slackSpaces.id, spaceIds[0]!));
        const result = await createTestClient().slack.updateBotSettings({
          regionOrgId: org.id,
          settings: {
            bot_token: "updated-secret",
            team_id: `TUPDATED${uniqueId()}`,
            workspace_name: "Updated Workspace",
            email_password: "updated-pw",
            unknown_internal: { ok: true },
            bot_log_channel: null,
            default_preblast_destination: "specified_channel",
            preblast_destination_channel: "CPRE",
            preblast_moleskin_template: [
              { type: "section", text: { type: "mrkdwn", text: "hi" } },
            ],
          },
        });
        expect(result.settings).toMatchObject({
          bot_token: "updated-secret",
          email_password: "updated-pw",
          unknown_legacy: "keep",
          unknown_internal: { ok: true },
          bot_log_channel: null,
          preblast_destination_channel: "CPRE",
        });

        const [space] = await db
          .select({
            settings: schema.slackSpaces.settings,
            botToken: schema.slackSpaces.botToken,
            teamId: schema.slackSpaces.teamId,
            workspaceName: schema.slackSpaces.workspaceName,
            updated: schema.slackSpaces.updated,
          })
          .from(schema.slackSpaces)
          .where(eq(schema.slackSpaces.id, spaceIds[0]!));
        expect(space?.settings).toMatchObject({
          bot_token: "updated-secret",
          email_password: "updated-pw",
          unknown_legacy: "keep",
          bot_log_channel: null,
        });
        expect(space?.botToken).toBe("updated-secret");
        expect(space?.teamId).toBe(result.settings.team_id);
        expect(space?.workspaceName).toBe("Updated Workspace");
        expect(space?.updated).not.toBe("2000-01-01 00:00:00");
      } finally {
        await cleanupSlack(org.id, spaceIds);
      }

      const duplicate = await createOrgWithSlack({ duplicate: true });
      try {
        await mockAuthWithSession(adminSessionForOrg(duplicate.org));
        await expect(
          createTestClient().slack.updateBotSettings({
            regionOrgId: duplicate.org.id,
            settings: { editing_locked: true },
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      } finally {
        await cleanupSlack(duplicate.org.id, duplicate.spaceIds);
      }
    });

    it("allows inherited admin and rejects unauthorized settings updates", async () => {
      const suffix = uniqueId();
      const [parent] = await db
        .insert(schema.orgs)
        .values({ name: `Parent ${suffix}`, orgType: "nation", isActive: true })
        .returning({ id: schema.orgs.id, name: schema.orgs.name });
      if (!parent) throw new Error("parent insert failed");
      const { org, spaceIds } = await createOrgWithSlack({
        parentId: parent.id,
      });
      try {
        await mockAuthWithSession(adminSessionForOrg(parent));
        await expect(
          createTestClient().slack.updateBotSettings({
            regionOrgId: org.id,
            settings: { editing_locked: true },
          }),
        ).resolves.toMatchObject({ settings: { editing_locked: true } });

        await mockAuthWithSession({
          ...adminSessionForOrg({ id: org.id + 9999, name: "Other" }),
          roles: [
            { orgId: org.id + 9999, orgName: "Other", roleName: "admin" },
          ],
        });
        await expect(
          createTestClient().slack.updateBotSettings({
            regionOrgId: org.id,
            settings: { editing_locked: false },
          }),
        ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      } finally {
        await cleanupSlack(org.id, spaceIds);
        await db
          .update(schema.orgs)
          .set({ parentId: null })
          .where(eq(schema.orgs.parentId, parent.id));
        await db.delete(schema.orgs).where(eq(schema.orgs.id, parent.id));
      }
    });
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

import type { Session } from "@acme/auth";
import { getSessionFromHeaders } from "@acme/auth";
import { auditContext, eq, runWithAuditContext, schema, sql } from "@acme/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { router } from "../index";

import {
  API_KEY_SESSION_USER_ID,
  protectedProcedure,
  publicReadProcedure,
} from "../shared";
import {
  cleanup,
  createAdminSession,
  db,
  getOrCreateF3NationOrg,
  getOrCreateRoles,
} from "./test-utils";

vi.mock("@acme/shared/common/constants", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isDevelopment: true,
}));

interface Attribution extends Record<string, unknown> {
  changed_by: number | null;
  changed_via: string | null;
}

const sessions = new Map<string, Session | null>();
const tagIds: number[] = [];
const keyIds: number[] = [];
const userIds: number[] = [];

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const sessionWithId = (id: unknown): Session => ({
  id: id as number,
  devMode: false,
  email: "audit-actor@example.com",
  user: { id: String(id), email: "audit-actor@example.com", roles: [] },
  roles: [],
  expires: new Date(Date.now() + 86_400_000).toISOString(),
});

async function insertTag(client = db) {
  const [row] = await client
    .insert(schema.eventTags)
    .values({ name: `audit actor ${randomUUID()}` })
    .returning({ id: schema.eventTags.id });
  if (!row) throw new Error("Missing synthetic tag");
  tagIds.push(row.id);
  return row.id;
}

async function tagHistory(id: number) {
  return db.execute<Attribution>(sql`
    SELECT changed_by, changed_via FROM public_history.event_tags
    WHERE row_id = ${String(id)} AND op = 'I'`);
}

function probeClient(
  request: string,
  beforeWrite: () => Promise<void> = () => Promise.resolve(),
  clientHeader?: string,
) {
  return createRouterClient(
    {
      write: publicReadProcedure.handler(async ({ context }) => {
        await beforeWrite();
        return insertTag(context.db);
      }),
    },
    {
      context: {
        reqHeaders: new Headers({
          "x-audit-request": request,
          ...(clientHeader ? { client: clientHeader } : {}),
        }),
      },
    },
  );
}

beforeEach(() => {
  sessions.clear();
  vi.mocked(getSessionFromHeaders).mockImplementation((headers) =>
    Promise.resolve(sessions.get(headers.get("x-audit-request") ?? "") ?? null),
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const id of tagIds.splice(0)) {
    await db.delete(schema.eventTags).where(eq(schema.eventTags.id, id));
  }
  for (const id of keyIds.splice(0)) await cleanup.apiKey(id);
  for (const id of userIds.splice(0)) await cleanup.user(id);
  vi.mocked(getSessionFromHeaders).mockReset();
});

describe("API request audit attribution", () => {
  it.each([
    ["f3-map", "f3-map"],
    ["f3-admin", "f3-admin"],
    ["f3-me", "f3-me"],
    ["f3-region-pages", "f3-region-pages"],
    ["orpc-ssg", "orpc-ssg"],
    ["f3-nation-slack-bot", "f3-nation-slack-bot"],
    ["scalar-api", "scalar-api"],
    [undefined, null],
    ["custom-website-42", "custom-website-42"],
    ["orpc", "orpc"],
    ["F3-MAP", "f3-map"],
    ["My App! v2.0", "myappv20"],
    ["f3'; drop--", "f3drop--"],
    ["!?_", null],
    ["X".repeat(129), "x".repeat(128)],
  ])(
    "records the claimed source %s independently of an anonymous actor",
    async (header, source) => {
      const id = await probeClient("anonymous", undefined, header).write();
      expect(await tagHistory(id)).toEqual([
        { changed_by: null, changed_via: source },
      ]);
    },
  );

  it("retains a signed-in actor with a custom source", async () => {
    sessions.set("custom-person", sessionWithId(42));
    const id = await probeClient(
      "custom-person",
      undefined,
      "Custom Website! 2",
    ).write();
    expect(await tagHistory(id)).toEqual([
      { changed_by: 42, changed_via: "customwebsite2" },
    ]);
  });

  it.each([
    { name: "Development Mode", id: 1, devMode: true, actor: null },
    { name: "legacy ambiguous user 1", id: 1, devMode: undefined, actor: null },
    {
      name: "legacy numeric-string user 1",
      id: "1",
      devMode: undefined,
      actor: null,
    },
    { name: "real user 1 after sign-in", id: 1, devMode: false, actor: 1 },
    { name: "legacy other user", id: 42, devMode: undefined, actor: 42 },
  ])(
    "persists $name attribution without changing the resolved identity",
    async ({ id, devMode, actor }) => {
      sessions.set("provenance", { ...sessionWithId(id), devMode });
      const client = createRouterClient(
        {
          write: publicReadProcedure.handler(async ({ context }) => ({
            id: await insertTag(context.db),
            actor: context.session?.id,
          })),
        },
        {
          context: {
            reqHeaders: new Headers({
              "x-audit-request": "provenance",
              client: "f3-admin",
            }),
          },
        },
      );
      const result = await client.write();
      expect(result.actor).toBe(id);
      expect(await tagHistory(result.id)).toEqual([
        { changed_by: actor, changed_via: "f3-admin" },
      ]);
    },
  );

  it.each([
    { name: "lower-bound actor", id: 1, actor: 1 },
    { name: "numeric actor", id: 42, actor: 42 },
    { name: "numeric-string actor", id: "43", actor: 43 },
    { name: "upper-bound actor", id: 2_147_483_647, actor: 2_147_483_647 },
    { name: "anonymous", id: null, actor: null },
    { name: "zero", id: 0, actor: null },
    { name: "negative", id: -1, actor: null },
    { name: "fractional", id: 1.5, actor: null },
    { name: "NaN", id: Number.NaN, actor: null },
    { name: "infinite", id: Number.POSITIVE_INFINITY, actor: null },
    { name: "nonnumeric string", id: "invalid", actor: null },
    { name: "boolean identity", id: true, actor: null },
    { name: "array identity", id: [1], actor: null },
    { name: "out-of-range", id: 2_147_483_648, actor: null },
  ])(
    "persists the $name attribution with NULL source",
    async ({ id, actor }) => {
      sessions.set("identity", id === null ? null : sessionWithId(id));
      const tagId = await probeClient("identity").write();
      expect(await tagHistory(tagId)).toEqual([
        { changed_by: actor, changed_via: null },
      ]);
    },
  );

  it("does not attribute API-key writes to the credential owner", async () => {
    const [owner] = await db
      .insert(schema.users)
      .values({ email: `audit-${randomUUID()}@example.com` })
      .returning({ id: schema.users.id });
    if (!owner) throw new Error("Missing synthetic owner");
    userIds.push(owner.id);
    const key = `synthetic-audit-${randomUUID()}`;
    const [credential] = await db
      .insert(schema.apiKeys)
      .values({ name: "synthetic audit credential", ownerId: owner.id, key })
      .returning({ id: schema.apiKeys.id });
    if (!credential) throw new Error("Missing synthetic credential");
    keyIds.push(credential.id);
    // A key with no roles counts as no credential, so grant one.
    await getOrCreateRoles();
    const [editor] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, "editor"));
    await db.insert(schema.rolesXApiKeysXOrg).values({
      apiKeyId: credential.id,
      roleId: editor!.id,
      orgId: (await getOrCreateF3NationOrg()).id,
    });
    const client = createRouterClient(
      {
        write: publicReadProcedure.handler(async ({ context }) => ({
          id: await insertTag(context.db),
          sessionUserId: context.session?.id,
          credentialId: context.session?.apiKey?.id,
        })),
      },
      {
        context: {
          reqHeaders: new Headers({
            authorization: `Bearer ${key}`,
            client: "f3-nation-slack-bot",
          }),
        },
      },
    );
    const result = await client.write();
    expect(result).toMatchObject({
      sessionUserId: API_KEY_SESSION_USER_ID,
      credentialId: credential.id,
    });
    expect(await tagHistory(result.id)).toEqual([
      { changed_by: null, changed_via: "f3-nation-slack-bot" },
    ]);
  });

  it("persists NULL for the actual protected-procedure development fallback", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHANNEL", "local");
    vi.stubEnv("ALLOW_DEV_MOCK_SESSION", "true");
    const client = createRouterClient(
      {
        write: protectedProcedure.handler(async ({ context }) => ({
          id: await insertTag(context.db),
          actor: context.session?.id,
        })),
      },
      { context: { reqHeaders: new Headers({ client: "f3-map" }) } },
    );
    const result = await client.write();
    expect(result.actor).toBe(0);
    expect(await tagHistory(result.id)).toEqual([
      { changed_by: null, changed_via: "f3-map" },
    ]);
    expect(process.env.NODE_ENV).toBe("test");
  });

  it("ignores a resolvable session on an SSG request while retaining its source", async () => {
    sessions.set("ssg-person", sessionWithId(42));
    const id = await probeClient("ssg-person", undefined, "orpc-ssg").write();
    expect(getSessionFromHeaders).not.toHaveBeenCalled();
    expect(await tagHistory(id)).toEqual([
      { changed_by: null, changed_via: "orpc-ssg" },
    ]);
  });

  it.each(["f3-admin", "Custom-App!"])(
    "does not authorize an anonymous caller from client %s",
    async (header) => {
      vi.stubEnv("ALLOW_DEV_MOCK_SESSION", "false");
      const name = `audit-denied-${randomUUID()}`;
      const client = createRouterClient(
        {
          write: protectedProcedure.handler(async ({ context }) => {
            await context.db.insert(schema.eventTags).values({ name });
          }),
        },
        { context: { reqHeaders: new Headers({ client: header }) } },
      );
      await expect(client.write()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(
        await db
          .select({ id: schema.eventTags.id })
          .from(schema.eventTags)
          .where(eq(schema.eventTags.name, name)),
      ).toEqual([]);
      const rows = await db.execute(
        sql`SELECT id FROM public_history.event_tags WHERE new_row->>'name' = ${name}`,
      );
      expect([...rows]).toEqual([]);
    },
  );

  it("clears inherited actor and source for an anonymous nested procedure", async () => {
    const tagId = await runWithAuditContext(
      { userId: 99, source: "outer" },
      () => probeClient("anonymous").write(),
    );
    expect(await tagHistory(tagId)).toEqual([
      { changed_by: null, changed_via: null },
    ]);
  });

  it("isolates overlapping requests and subsequent anonymous and direct writes", async () => {
    sessions.set("a", sessionWithId(71));
    sessions.set("b", sessionWithId(72));
    const arrivedA = barrier();
    const arrivedB = barrier();
    const releaseA = barrier();
    const releaseB = barrier();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      deadline = setTimeout(
        () => reject(new Error("Request handlers did not overlap")),
        2_000,
      );
    });
    const a = probeClient(
      "a",
      async () => {
        arrivedA.resolve();
        await releaseA.promise;
      },
      "f3-map",
    ).write();
    const b = probeClient(
      "b",
      async () => {
        arrivedB.resolve();
        await releaseB.promise;
      },
      "f3-admin",
    ).write();
    try {
      await Promise.race([
        Promise.all([arrivedA.promise, arrivedB.promise]),
        stalled,
      ]);
      releaseB.resolve();
      const idB = await b;
      releaseA.resolve();
      const idA = await a;
      const anonymousId = await probeClient("anonymous").write();
      const directId = await insertTag();
      expect(await tagHistory(idA)).toEqual([
        { changed_by: 71, changed_via: "f3-map" },
      ]);
      expect(await tagHistory(idB)).toEqual([
        { changed_by: 72, changed_via: "f3-admin" },
      ]);
      expect(await tagHistory(anonymousId)).toEqual([
        { changed_by: null, changed_via: null },
      ]);
      expect(await tagHistory(directId)).toEqual([
        { changed_by: null, changed_via: null },
      ]);
    } finally {
      clearTimeout(deadline);
      releaseA.resolve();
      releaseB.resolve();
      await Promise.allSettled([a, b]);
    }
  });

  it("attributes detached work after the procedure returns and permits explicit exit", async () => {
    sessions.set("background", sessionWithId(81));
    const release = barrier();
    let detached: Promise<number> | undefined;
    let optedOut: Promise<number> | undefined;
    const client = createRouterClient(
      {
        start: publicReadProcedure.handler(() => {
          detached = release.promise.then(() => insertTag());
          optedOut = auditContext.exit(() =>
            release.promise.then(() => insertTag()),
          );
          return "scheduled";
        }),
      },
      {
        context: {
          reqHeaders: new Headers({
            "x-audit-request": "background",
            client: "f3-me",
          }),
        },
      },
    );
    try {
      expect(await client.start()).toBe("scheduled");
      release.resolve();
      expect(detached).toBeDefined();
      expect(optedOut).toBeDefined();
      const [inheritedId, exitedId] = await Promise.all([detached!, optedOut!]);
      expect(await tagHistory(inheritedId)).toEqual([
        { changed_by: 81, changed_via: "f3-me" },
      ]);
      expect(await tagHistory(exitedId)).toEqual([
        { changed_by: null, changed_via: null },
      ]);
    } finally {
      release.resolve();
      await Promise.allSettled([detached, optedOut]);
    }
  });

  it("records the actor of an existing production-router mutation", async () => {
    const [owner] = await db
      .insert(schema.users)
      .values({ email: `audit-${randomUUID()}@example.com` })
      .returning({ id: schema.users.id });
    if (!owner) throw new Error("Missing synthetic actor");
    userIds.push(owner.id);
    expect(owner.id).not.toBe(1);
    const admin = await createAdminSession();
    const session = {
      ...admin,
      id: owner.id,
      devMode: false,
      user: { ...admin.user, id: String(owner.id), roles: admin.roles ?? [] },
    };
    vi.mocked(getSessionFromHeaders).mockResolvedValue(session);
    const client = createRouterClient(router, {
      context: { reqHeaders: new Headers({ client: "f3-admin" }) },
    });
    const result = await client.apiKey.create({
      roles: [
        { orgId: (await getOrCreateF3NationOrg()).id, roleName: "editor" },
      ],
      name: "synthetic audit mutation",
    });
    keyIds.push(result.id);
    const rows = await db.execute<Attribution>(sql`
      SELECT changed_by, changed_via FROM public_history.api_keys
      WHERE row_id = ${String(result.id)} AND op = 'I'`);
    expect(rows).toEqual([{ changed_by: owner.id, changed_via: "f3-admin" }]);
  });
});

import type { Session } from "@acme/auth";
import { getSessionFromHeaders } from "@acme/auth";
import { auditContext, eq, runWithAuditContext, schema, sql } from "@acme/db";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { protectedProcedure, publicReadProcedure } from "../shared";
import {
  cleanup,
  createAdminSession,
  createTestClient,
  db,
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
) {
  return createRouterClient(
    {
      write: publicReadProcedure.handler(async ({ context }) => {
        await beforeWrite();
        return insertTag(context.db);
      }),
    },
    { context: { reqHeaders: new Headers({ "x-audit-request": request }) } },
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
            reqHeaders: new Headers({ "x-audit-request": "provenance" }),
          },
        },
      );
      const result = await client.write();
      expect(result.actor).toBe(id);
      expect(await tagHistory(result.id)).toEqual([
        { changed_by: actor, changed_via: null },
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
    const client = createRouterClient(
      {
        write: publicReadProcedure.handler(async ({ context }) => ({
          id: await insertTag(context.db),
          ownerId: context.session?.id,
          credentialId: context.session?.apiKey?.id,
        })),
      },
      {
        context: {
          reqHeaders: new Headers({
            authorization: `Bearer ${key}`,
            client: "audit-test",
          }),
        },
      },
    );
    const result = await client.write();
    expect(result).toMatchObject({
      ownerId: owner.id,
      credentialId: credential.id,
    });
    expect(await tagHistory(result.id)).toEqual([
      { changed_by: null, changed_via: null },
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
      { context: { reqHeaders: new Headers() } },
    );
    const result = await client.write();
    expect(result.actor).toBe(0);
    expect(await tagHistory(result.id)).toEqual([
      { changed_by: null, changed_via: null },
    ]);
    expect(process.env.NODE_ENV).toBe("test");
  });

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
    const a = probeClient("a", async () => {
      arrivedA.resolve();
      await releaseA.promise;
    }).write();
    const b = probeClient("b", async () => {
      arrivedB.resolve();
      await releaseB.promise;
    }).write();
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
        { changed_by: 71, changed_via: null },
      ]);
      expect(await tagHistory(idB)).toEqual([
        { changed_by: 72, changed_via: null },
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
          reqHeaders: new Headers({ "x-audit-request": "background" }),
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
        { changed_by: 81, changed_via: null },
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
    const result = await createTestClient().apiKey.create({
      name: "synthetic audit mutation",
    });
    keyIds.push(result.id);
    const rows = await db.execute<Attribution>(sql`
      SELECT changed_by, changed_via FROM public_history.api_keys
      WHERE row_id = ${String(result.id)} AND op = 'I'`);
    expect(rows).toEqual([{ changed_by: owner.id, changed_via: null }]);
  });
});

import { vi } from "vitest";
const mockLimit = vi.hoisted(() => vi.fn());
vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn(function () {
    return { limit: mockLimit };
  }),
}));
import { eq, schema, sql } from "@acme/db";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  cleanup,
  createAdminSession,
  createTestClient,
  db,
  getOrCreateRoles,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

let userId: number;
let userEmail: string;
const meta = {
  my_f3_why: "synthetic reason",
  strava_access_token: "synthetic-access",
  strava_refresh_token: "synthetic-refresh",
  strava_future: "synthetic-secret",
};
beforeAll(async () => {
  await getOrCreateRoles();
  const [user] = await db
    .insert(schema.users)
    .values({ email: `${uniqueId()}@example.invalid`, meta })
    .returning();
  if (!user) throw new Error("Synthetic user missing");
  userId = user.id;
  userEmail = user.email;
  await db.insert(schema.userStravaCredentials).values({
    userId,
    athleteId: 7000020,
    accessToken: "synthetic-store-access",
    refreshToken: "synthetic-store-refresh",
    expiresAt: 2000000000,
  });
});
beforeEach(async () => {
  mockLimit.mockResolvedValue({
    success: true,
    limit: 100,
    remaining: 99,
    reset: Date.now() + 60000,
  });
  await mockAuthWithSession(await createAdminSession());
});
afterAll(async () => {
  await cleanup.user(userId);
  await db.execute(
    sql`DELETE FROM public_history.users WHERE row_id = ${String(userId)}`,
  );
});

it.each([false, true])(
  "filters real detail responses with includePii=%s",
  async (includePii) => {
    const result = await createTestClient().user.byId({
      id: userId,
      includePii,
    });
    expect(result.user?.meta).toEqual({ my_f3_why: "synthetic reason" });
  },
);
it("rejects an administrator's credential write without changing persisted metadata", async () => {
  const [before] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  await expect(
    createTestClient().user.crupdate({
      id: userId,
      roles: [],
      f3Name: "Rejected administrator edit",
      meta: { strava_access_token: "replacement" },
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0]
      ?.meta,
  ).toEqual(meta);
  expect(
    (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0]
      ?.f3Name,
  ).toBe(before?.f3Name);
});
it("filters self profile and mutation responses and rejects self credential writes", async () => {
  await mockAuthWithSession({
    id: userId,
    email: "synthetic@example.invalid",
    user: {
      id: String(userId),
      email: "synthetic@example.invalid",
      name: "Synthetic",
      roles: [],
    },
    roles: [],
    expires: new Date(Date.now() + 86400000).toISOString(),
  });
  const client = createTestClient();
  const [before] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  const credentialsBefore = await db
    .select()
    .from(schema.userStravaCredentials)
    .where(eq(schema.userStravaCredentials.userId, userId));
  expect((await client.me.profile()).user.meta).toEqual({
    my_f3_why: "synthetic reason",
  });
  await expect(
    client.me.updateProfile({
      f3Name: "Rejected self edit",
      meta: { strava_refresh_token: null },
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(
    (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0]
      ?.meta,
  ).toEqual(meta);
  expect(
    (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0]
      ?.f3Name,
  ).toBe(before?.f3Name);
  expect(
    (await client.me.updateProfile({ f3Name: "Synthetic edited" })).user.meta,
  ).toEqual({ my_f3_why: "synthetic reason" });
  expect(
    await db
      .select()
      .from(schema.userStravaCredentials)
      .where(eq(schema.userStravaCredentials.userId, userId)),
  ).toEqual(credentialsBefore);
});

it.each([false, true])(
  "filters search/list responses with includePii=%s",
  async (includePii) => {
    const result = await createTestClient().user.all({
      searchTerm: userEmail,
      includePii,
    });
    expect(
      result.users.map((user) => ({ id: user.id, meta: user.meta })),
    ).toEqual([{ id: userId, meta: { my_f3_why: "synthetic reason" } }]);
  },
);

it("filters an API key response and rejects its credential write", async () => {
  const session = await createAdminSession();
  if (!session.roles?.length) throw new Error("Synthetic admin roles missing");
  await mockAuthWithSession({
    ...session,
    apiKey: {
      id: 1,
      key: "synthetic-key",
      ownerId: session.id,
      revokedAt: null,
      expiresAt: null,
      orgIds: session.roles.map((role) => role.orgId),
    },
  });
  const client = createTestClient();
  expect(
    (await client.user.byId({ id: userId, includePii: true })).user?.meta,
  ).toEqual({ my_f3_why: "synthetic reason" });
  await expect(
    client.user.crupdate({
      id: userId,
      roles: [],
      meta: { strava_refresh_token: "synthetic-replacement" },
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("returns a sanitized general profile mutation and preserves the stored connection", async () => {
  const result = await createTestClient().user.crupdate({
    id: userId,
    roles: [],
    f3Name: "Synthetic changed",
  });
  expect(result.meta).toEqual({ my_f3_why: "synthetic reason" });
  expect(
    await db
      .select()
      .from(schema.userStravaCredentials)
      .where(eq(schema.userStravaCredentials.userId, userId)),
  ).toEqual([
    {
      userId,
      athleteId: 7000020,
      accessToken: "synthetic-store-access",
      refreshToken: "synthetic-store-refresh",
      expiresAt: 2000000000,
    },
  ]);
});

it("preserves the by-email endpoint's email contract without exposing Strava metadata", async () => {
  const result = await createTestClient().user.byEmail({
    email: userEmail,
    includePii: false,
  });
  expect(result.user?.email).toBe(userEmail);
  expect(result.user?.meta).toEqual({ my_f3_why: "synthetic reason" });
});

it.each([
  {
    malformed: JSON.stringify(meta),
    expected: { my_f3_why: "synthetic reason" },
  },
  { malformed: "strava_access_token=synthetic-access", expected: null },
  { malformed: [meta], expected: null },
])(
  "does not expose non-object stored metadata %j",
  async ({ malformed, expected }) => {
    try {
      await db.execute(
        sql`UPDATE users SET meta = ${JSON.stringify(malformed)}::jsonb WHERE id = ${userId}`,
      );
      const result = await createTestClient().user.byId({
        id: userId,
        includePii: true,
      });
      expect(result.user?.meta).toEqual(expected);
      await mockAuthWithSession({
        id: userId,
        email: userEmail,
        user: {
          id: String(userId),
          email: userEmail,
          name: "Synthetic",
          roles: [],
        },
        roles: [],
        expires: new Date(Date.now() + 86400000).toISOString(),
      });
      expect((await createTestClient().me.profile()).user.meta).toEqual(
        expected,
      );
    } finally {
      await db
        .update(schema.users)
        .set({ meta })
        .where(eq(schema.users.id, userId));
    }
  },
);

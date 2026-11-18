import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq, schema, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../db/drizzle/0036_isolate_legacy_strava_credentials.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = new Error("synthetic transaction rollback");

it("preserves a fresh reconnect, imports a missing row and scrubs live and audited metadata", async () => {
  await expect(
    db.transaction(async (tx) => {
      const legacy = {
        strava_athlete_id: 7000001,
        strava_access_token: "synthetic-old",
        strava_refresh_token: "synthetic-old-refresh",
        strava_expires_at: 1900000000,
        my_f3_why: "synthetic retained",
      };
      const [first, second] = await tx
        .insert(schema.users)
        .values([
          { email: "strava-migration-first@example.invalid", meta: legacy },
          {
            email: "strava-migration-second@example.invalid",
            meta: { ...legacy, strava_athlete_id: 7000002 },
          },
        ])
        .returning();
      if (!first || !second) throw new Error("Synthetic fixture missing");
      const slackBefore = await tx
        .insert(schema.slackUsers)
        .values(
          [first, second].map((user, index) => ({
            slackId: `synthetic-member-${randomUUID()}`,
            slackTeamId: `synthetic-workspace-${randomUUID()}`,
            userId: user.id,
            userName: `synthetic-member-${index}`,
            email: user.email,
            isAdmin: false,
            isOwner: false,
            isBot: false,
            stravaAccessToken: index === 0 ? "synthetic-slack-access" : null,
            stravaRefreshToken: index === 0 ? "synthetic-slack-refresh" : null,
            stravaExpiresAt: index === 0 ? "2030-01-01 00:00:00" : null,
            stravaAthleteId: 7100000 + index,
          })),
        )
        .returning();
      const fresh = {
        userId: first.id,
        athleteId: 7000003,
        accessToken: "synthetic-fresh",
        refreshToken: "synthetic-fresh-refresh",
        expiresAt: 2000000000,
      };
      await tx.insert(schema.userStravaCredentials).values(fresh);
      const historyBefore = await tx.execute(
        sql`select id, row_id, op, changed_by, changed_via, changed_at from public_history.users where row_id in (${first.id}, ${second.id}) order by id`,
      );
      await tx.execute(sql.raw(migration));
      for (const slack of slackBefore) {
        expect(
          await tx
            .select()
            .from(schema.slackUsers)
            .where(eq(schema.slackUsers.id, slack.id)),
        ).toEqual([
          {
            ...slack,
            stravaAccessToken: null,
            stravaRefreshToken: null,
            stravaExpiresAt: null,
            stravaAthleteId: null,
          },
        ]);
      }
      expect(
        await tx
          .select()
          .from(schema.userStravaCredentials)
          .where(eq(schema.userStravaCredentials.userId, first.id)),
      ).toEqual([fresh]);
      expect(
        await tx
          .select()
          .from(schema.userStravaCredentials)
          .where(eq(schema.userStravaCredentials.userId, second.id)),
      ).toEqual([
        {
          ...fresh,
          userId: second.id,
          athleteId: 7000002,
          accessToken: "synthetic-old",
          refreshToken: "synthetic-old-refresh",
          expiresAt: 1900000000,
        },
      ]);
      expect(
        (
          await tx
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, first.id))
        )[0]?.meta,
      ).toEqual({ my_f3_why: "synthetic retained" });
      const historyAfter = await tx.execute(
        sql`select id, row_id, op, changed_by, changed_via, changed_at from public_history.users where row_id in (${first.id}, ${second.id}) order by id`,
      );
      expect(historyAfter.slice(0, historyBefore.length)).toEqual(
        historyBefore,
      );
      expect(historyAfter.length).toBe(historyBefore.length + 2);
      const snapshots = await tx.execute(
        sql`select old_row, new_row from public_history.users where row_id in (${first.id}, ${second.id})`,
      );
      for (const snapshot of snapshots) {
        for (const side of [snapshot.old_row, snapshot.new_row]) {
          if (side !== null)
            expect((side as { meta: unknown }).meta).toEqual({
              my_f3_why: "synthetic retained",
            });
        }
      }
      await tx.execute(sql.raw(migration));
      expect(
        await tx.execute(
          sql`select old_row, new_row from public_history.users where row_id in (${first.id}, ${second.id})`,
        ),
      ).toEqual(snapshots);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});

it("rolls back imported credentials and active cleanup when history contains malformed metadata", async () => {
  await expect(
    db.transaction(async (tx) => {
      const legacy = {
        strava_athlete_id: 7000008,
        strava_access_token: "synthetic-old",
        strava_refresh_token: "synthetic-refresh",
        strava_expires_at: 1900000000,
      };
      const [user] = await tx
        .insert(schema.users)
        .values({ email: "strava-rollback@example.invalid", meta: legacy })
        .returning();
      if (!user) throw new Error("Synthetic user missing");
      await tx.execute(
        sql`INSERT INTO public_history.users (row_id, op, old_row) VALUES (${String(user.id)}, 'U', '{"meta": "malformed"}'::jsonb)`,
      );
      await expect(
        tx.transaction(async (savepoint) => {
          await savepoint.execute(sql.raw(migration));
        }),
      ).rejects.toMatchObject({
        cause: { message: "Strava migration requires object or null metadata" },
      });
      expect(
        await tx
          .select()
          .from(schema.userStravaCredentials)
          .where(eq(schema.userStravaCredentials.userId, user.id)),
      ).toEqual([]);
      expect(
        (
          await tx
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, user.id))
        )[0]?.meta,
      ).toEqual(legacy);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});

it("refuses cross-user athlete ownership conflicts atomically", async () => {
  await expect(
    db.transaction(async (tx) => {
      const legacy = {
        strava_athlete_id: 7000009,
        strava_access_token: "synthetic-old",
        strava_refresh_token: "synthetic-refresh",
        strava_expires_at: 1900000000,
      };
      const users = await tx
        .insert(schema.users)
        .values([
          { email: "strava-conflict-one@example.invalid", meta: legacy },
          { email: "strava-conflict-two@example.invalid", meta: legacy },
        ])
        .returning();
      await expect(
        tx.transaction(async (savepoint) => {
          await savepoint.execute(sql.raw(migration));
        }),
      ).rejects.toMatchObject({
        cause: {
          message: "Strava migration found conflicting athlete ownership",
        },
      });
      for (const user of users) {
        expect(
          await tx
            .select()
            .from(schema.userStravaCredentials)
            .where(eq(schema.userStravaCredentials.userId, user.id)),
        ).toEqual([]);
        expect(
          (
            await tx
              .select()
              .from(schema.users)
              .where(eq(schema.users.id, user.id))
          )[0]?.meta,
        ).toEqual(legacy);
      }
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});

it("keeps fresh credentials despite incomplete legacy keys and preserves null/absent history metadata", async () => {
  await expect(
    db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({
          email: "strava-null-history@example.invalid",
          meta: { strava_future: "synthetic-obsolete", my_f3_why: "keep" },
        })
        .returning();
      if (!user) throw new Error("Synthetic fixture missing");
      const fresh = {
        userId: user.id,
        athleteId: 7000010,
        accessToken: "synthetic-fresh",
        refreshToken: "synthetic-refresh",
        expiresAt: 2000000000,
      };
      await tx.insert(schema.userStravaCredentials).values(fresh);
      const [history] = await tx.execute(
        sql`INSERT INTO public_history.users (row_id, op, old_row, new_row) VALUES (${String(user.id)}, 'U', '{"unrelated":42}'::jsonb, '{"meta":null,"unrelated":42}'::jsonb) RETURNING *`,
      );
      await tx.execute(sql.raw(migration));
      expect(
        await tx
          .select()
          .from(schema.userStravaCredentials)
          .where(eq(schema.userStravaCredentials.userId, user.id)),
      ).toEqual([fresh]);
      expect(
        (
          await tx
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, user.id))
        )[0]?.meta,
      ).toEqual({ my_f3_why: "keep" });
      expect(
        (
          await tx.execute(
            sql`SELECT * FROM public_history.users WHERE id = ${history!.id}`,
          )
        )[0],
      ).toEqual(history);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});

it.each([
  {
    name: "missing token",
    changes: { strava_refresh_token: null },
    message: "Strava migration found an incomplete legacy bundle",
  },
  {
    name: "empty access token",
    changes: { strava_access_token: "" },
    message: "Strava migration found an incomplete legacy bundle",
  },
  {
    name: "invalid athlete identifier",
    changes: { strava_athlete_id: -1 },
    message: "Strava migration found an incomplete legacy bundle",
  },
  {
    name: "invalid expiry",
    changes: { strava_expires_at: 1.5 },
    message: "Strava migration found an incomplete legacy bundle",
  },
  {
    name: "out-of-range identifier",
    changes: { strava_athlete_id: 1e20 },
    message: "Strava migration found invalid legacy identifiers or expiry",
  },
  {
    name: "out-of-range expiry",
    changes: { strava_expires_at: 1e20 },
    message: "Strava migration found invalid legacy identifiers or expiry",
  },
])(
  "rejects $name without exposing tokens or changing persisted data",
  async ({ changes, message }) => {
    await expect(
      db.transaction(async (tx) => {
        const legacy = {
          strava_athlete_id: 7000014,
          strava_access_token: "synthetic-validation-access",
          strava_refresh_token: "synthetic-validation-refresh",
          strava_expires_at: 1900000000,
          ...changes,
        };
        const [user] = await tx
          .insert(schema.users)
          .values({
            email: `strava-invalid-${randomUUID()}@example.invalid`,
            meta: legacy,
          })
          .returning();
        if (!user) throw new Error("Synthetic fixture missing");
        const historyBefore = await tx.execute(
          sql`SELECT * FROM public_history.users WHERE row_id = ${String(user.id)} ORDER BY id`,
        );
        let migrationError: unknown;
        try {
          await tx.transaction(async (savepoint) => {
            await savepoint.execute(sql.raw(migration));
          });
        } catch (error) {
          migrationError = error;
        }
        expect(migrationError).toMatchObject({ cause: { message } });
        const serialized = JSON.stringify(
          migrationError,
          (_key, value: unknown) =>
            value instanceof Error
              ? {
                  ...value,
                  message: value.message,
                  stack: value.stack,
                  cause: value.cause,
                }
              : value,
        );
        expect(serialized).not.toContain("synthetic-validation-access");
        expect(serialized).not.toContain("synthetic-validation-refresh");
        expect(
          await tx
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, user.id)),
        ).toEqual([user]);
        expect(
          await tx
            .select()
            .from(schema.userStravaCredentials)
            .where(eq(schema.userStravaCredentials.userId, user.id)),
        ).toEqual([]);
        expect(
          await tx.execute(
            sql`SELECT * FROM public_history.users WHERE row_id = ${String(user.id)} ORDER BY id`,
          ),
        ).toEqual(historyBefore);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  },
);

it.each([false, true])(
  "preserves concurrent reconnects with a later incomplete bundle: %s",
  async (laterReconnect) => {
    const fixtureIds: number[] = [];
    let backfill: Promise<unknown> | undefined;
    try {
      const [user] = await db
        .insert(schema.users)
        .values({
          email: `strava-concurrent-${randomUUID()}@example.invalid`,
          meta: {
            strava_athlete_id: 7000011,
            strava_access_token: "synthetic-legacy",
            strava_refresh_token: "synthetic-legacy-refresh",
            strava_expires_at: 1900000000,
          },
        })
        .returning();
      if (!user) throw new Error("Synthetic fixture missing");
      fixtureIds.push(user.id);
      const fresh = {
        userId: user.id,
        athleteId: 7000012,
        accessToken: "synthetic-fresh",
        refreshToken: "synthetic-fresh-refresh",
        expiresAt: 2000000000,
      };
      const [laterUser] = laterReconnect
        ? await db
            .insert(schema.users)
            .values({
              email: `strava-concurrent-later-${randomUUID()}@example.invalid`,
              meta: {
                strava_future: "synthetic-obsolete",
                my_f3_why: "keep",
              },
            })
            .returning()
        : [];
      if (laterUser) fixtureIds.push(laterUser.id);
      const laterFresh = laterUser
        ? { ...fresh, userId: laterUser.id, athleteId: 7000013 }
        : undefined;
      await db.transaction(async (connection) => {
        await connection.insert(schema.userStravaCredentials).values(fresh);
        const [backend] = await connection.execute(
          sql`SELECT pg_backend_pid() AS pid`,
        );
        backfill = db.transaction(async (tx) => {
          await tx.execute(sql.raw(migration));
        });
        // Attach a handler while observing the lock, so a premature error cannot
        // become an unhandled rejection before the holder transaction finishes.
        void backfill.catch(() => undefined);
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          await connection.execute(sql`SELECT pg_stat_clear_snapshot()`);
          const [lock] = await connection.execute(
            sql`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${backend!.pid}::int = ANY(pg_blocking_pids(pid))) AS waiting`,
          );
          if (lock?.waiting) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        if (laterFresh)
          await db.insert(schema.userStravaCredentials).values(laterFresh);
      });
      await backfill;
      expect(
        await db
          .select()
          .from(schema.userStravaCredentials)
          .where(eq(schema.userStravaCredentials.userId, user.id)),
      ).toEqual([fresh]);
      expect(
        (
          await db
            .select()
            .from(schema.users)
            .where(eq(schema.users.id, user.id))
        )[0]?.meta,
      ).toEqual({});
      if (laterUser && laterFresh) {
        expect(
          await db
            .select()
            .from(schema.userStravaCredentials)
            .where(eq(schema.userStravaCredentials.userId, laterUser.id)),
        ).toEqual([laterFresh]);
        expect(
          (
            await db
              .select()
              .from(schema.users)
              .where(eq(schema.users.id, laterUser.id))
          )[0]?.meta,
        ).toEqual({ my_f3_why: "keep" });
      }
    } finally {
      await backfill?.catch(() => undefined);
      for (const id of fixtureIds) {
        await db.delete(schema.users).where(eq(schema.users.id, id));
        await db.execute(
          sql`DELETE FROM public_history.users WHERE row_id = ${String(id)}`,
        );
      }
    }
  },
);

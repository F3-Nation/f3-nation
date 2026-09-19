import { authSchema, eq, schema } from "@acme/db";
import { afterAll, describe, expect, it } from "vitest";

import { db, uniqueId } from "../testing";

// Coverage for #953's DB-level fix (PR #1032): the FK cascade from
// better_auth_user.f3_user_id to users.id, and the AFTER UPDATE OF email
// trigger that keeps better_auth_user.email in sync. Lives here rather than
// packages/db because that package has no vitest harness of its own — this
// package already has the live-Postgres one (TEST_DATABASE_URL + global
// setup), and both tables are reachable through the same @acme/db client.
describe("better_auth_user sync with users (#953)", () => {
  const createdUserIds: number[] = [];

  afterAll(async () => {
    for (const id of createdUserIds.reverse()) {
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
  });

  async function createUser(email: string) {
    const [user] = await db.insert(schema.users).values({ email }).returning();
    if (!user) throw new Error("Failed to create test user");
    createdUserIds.push(user.id);
    return user;
  }

  async function createBetterAuthUser(userId: number, email: string) {
    await db.insert(authSchema.betterAuthUser).values({
      id: String(userId),
      name: "Test PAX",
      email,
    });
  }

  it("syncs better_auth_user.email, lowercased, when users.email changes", async () => {
    const email = `${uniqueId()}@f3nation.test`;
    const user = await createUser(email);
    await createBetterAuthUser(user.id, email.toLowerCase());

    const newEmail = `  ${uniqueId()}@F3Nation.Test  `; // mixed case + whitespace on write
    await db
      .update(schema.users)
      .set({ email: newEmail })
      .where(eq(schema.users.id, user.id));

    const [shadow] = await db
      .select()
      .from(authSchema.betterAuthUser)
      .where(eq(authSchema.betterAuthUser.id, String(user.id)));

    expect(shadow?.email).toBe(newEmail.trim().toLowerCase());
  });

  it("removes the better_auth_user row (and its session) when the users row is deleted", async () => {
    const email = `${uniqueId()}@f3nation.test`;
    const user = await createUser(email);
    await createBetterAuthUser(user.id, email);
    await db.insert(authSchema.betterAuthSession).values({
      id: `${uniqueId()}-session`,
      token: uniqueId(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      userId: String(user.id),
    });

    await db.delete(schema.users).where(eq(schema.users.id, user.id));
    createdUserIds.splice(createdUserIds.indexOf(user.id), 1);

    const [shadow] = await db
      .select()
      .from(authSchema.betterAuthUser)
      .where(eq(authSchema.betterAuthUser.id, String(user.id)));
    expect(shadow).toBeUndefined();

    const [session] = await db
      .select()
      .from(authSchema.betterAuthSession)
      .where(eq(authSchema.betterAuthSession.userId, String(user.id)));
    expect(session).toBeUndefined();
  });

  it("cannot leave a stale row behind to hijack a reassigned email", async () => {
    // User A signs in via Better Auth, then their users row is deleted
    // (account merge). Per the cascade above, their better_auth_user row
    // goes with it — so when the email is later reassigned to a brand-new
    // user B, there is no stale row left to sign B in as A.
    const email = `${uniqueId()}@f3nation.test`;
    const userA = await createUser(email);
    await createBetterAuthUser(userA.id, email);

    await db.delete(schema.users).where(eq(schema.users.id, userA.id));
    createdUserIds.splice(createdUserIds.indexOf(userA.id), 1);

    const userB = await createUser(email);
    await createBetterAuthUser(userB.id, email);

    const [shadow] = await db
      .select()
      .from(authSchema.betterAuthUser)
      .where(eq(authSchema.betterAuthUser.email, email));
    expect(shadow?.id).toBe(String(userB.id));
  });

  it("refuses an email sync that would collide with a stale/other shadow row", async () => {
    // users.email is itself globally unique, so two *live* users can never
    // race for the same email at the users-table level — the trigger's own
    // unique_violation handler exists for the other case: a better_auth_user
    // row that's drifted out of sync with its own live user's email (e.g.
    // seeded before this trigger existed, or hand-edited). Simulate that by
    // writing userB's shadow row to a value that isn't userB's own email.
    const emailA = `${uniqueId()}@f3nation.test`;
    const emailB = `${uniqueId()}@f3nation.test`;
    const staleEmail = `${uniqueId()}@f3nation.test`;
    const userA = await createUser(emailA);
    const userB = await createUser(emailB);
    await createBetterAuthUser(userA.id, emailA);
    await createBetterAuthUser(userB.id, staleEmail);

    // Admin renames A's email to the value B's stale shadow row already
    // holds. Nothing on the live users table conflicts (no user's email is
    // staleEmail), so this reaches the trigger, which then collides on
    // better_auth_user_email_key. The postgres-js/drizzle driver wraps the
    // real PostgresError in `.cause` rather than the top-level message.
    let thrown: unknown;
    try {
      await db
        .update(schema.users)
        .set({ email: staleEmail })
        .where(eq(schema.users.id, userA.id));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const cause = (thrown as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    const causeMessage = (cause as Error).message;
    expect(causeMessage).toContain("Manual reconciliation required");
    // The trigger deliberately omits the email from its exception message
    // (see its own SQL comment) — callers log the raw driver error on an
    // unexpected fault, so a leaked email here would bypass that safeguard.
    expect(causeMessage).not.toContain(emailA);
    expect(causeMessage).not.toContain(emailB);
    expect(causeMessage).not.toContain(staleEmail);
  });
});

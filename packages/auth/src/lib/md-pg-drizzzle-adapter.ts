import type { AuthConfig } from "@auth/core";
import type { PgDatabase } from "drizzle-orm/pg-core";
import dayjs from "dayjs";
import { and, count, eq, gt, lt, lte } from "drizzle-orm";
import omit from "lodash/omit";

import type { UserRole } from "@acme/shared/app/enums";
import { normalizeEmail } from "@acme/shared/common/functions";
import { ilike } from "drizzle-orm";
import { schema, sql } from "@acme/db";

import type { MdAdapter } from "./adapter-types";
import { logDebug, logInfo } from "../logger";

const {
  users,
  roles,
  orgs,
  rolesXUsersXOrg,
  authAccounts: accounts,
  authSessions: sessions,
  authVerificationSends: verificationSends,
  authVerificationTokens: verificationTokens,
} = schema;

// Every sign-in email carries a code or link someone may try to guess, and
// is mail sent from F3's domain, so one address gets at most this many an
// hour and none within the cooldown of the last.
const MAX_SENDS_PER_HOUR = 5;
const utcNow = sql`timezone('utc'::text, now())`;
const SEND_COOLDOWN = sql`interval '30 seconds'`;
const SEND_WINDOW = sql`interval '1 hour'`;

type PgClient = InstanceType<typeof PgDatabase>;

/**
 * Token timestamps are UTC stored without a zone. `new Date()` reads a
 * zoneless string as local time, which would shift `expires` on any host not
 * running in UTC.
 */
const parseUtcTimestamp = (value: string) =>
  new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);

/**
 * Holds, until the transaction ends, a lock that serializes sends and
 * redemptions for one address, so parallel requests can't each count or
 * guess against the same live token.
 */
const lockIdentifier = (tx: PgClient, identifier: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`auth-verification:${identifier}`}))`,
  );

/**
 * Ends every live token of the address. Auth.js rejects a past `expires` by
 * the app server's clock, which can trail the database's, so the new
 * `expires` is set well before the database's now.
 */
const expireLiveTokens = (tx: PgClient, identifier: string) =>
  tx
    .update(verificationTokens)
    .set({ expires: sql`${utcNow} - interval '1 day'` })
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        gt(verificationTokens.expires, utcNow),
      ),
    );

/**
 * Records a sign-in email to the address and returns true, or returns false
 * and records nothing when the address is within the cooldown of its last
 * send or has had MAX_SENDS_PER_HOUR in the last hour.
 */
export const reserveVerificationSend = (
  client: PgClient,
  rawIdentifier: string,
): Promise<boolean> => {
  const identifier = normalizeEmail(rawIdentifier);
  return client.transaction(async (tx) => {
    await lockIdentifier(tx, identifier);
    // Sends older than the window no longer count toward the limit.
    await tx
      .delete(verificationSends)
      .where(
        and(
          eq(verificationSends.identifier, identifier),
          lt(verificationSends.created, sql`${utcNow} - ${SEND_WINDOW}`),
        ),
      );
    const [recent] = await tx
      .select({
        inWindow: count(),
        inCooldown: count(
          sql`case when ${verificationSends.created} > ${utcNow} - ${SEND_COOLDOWN} then 1 end`,
        ),
      })
      .from(verificationSends)
      .where(eq(verificationSends.identifier, identifier));
    if (
      recent &&
      (recent.inCooldown > 0 || recent.inWindow >= MAX_SENDS_PER_HOUR)
    ) {
      return false;
    }
    await tx.insert(verificationSends).values({ identifier });
    return true;
  });
};

type SignInCallback = NonNullable<
  NonNullable<AuthConfig["callbacks"]>["signIn"]
>;

/**
 * The `signIn` callback that holds sign-in emails to the per-address limit.
 * Auth.js starts sending the email before it calls `createVerificationToken`,
 * so a refusal there would still mail an unusable code. It calls `signIn`
 * before either, and a `false` from it sends and stores nothing.
 */
export const limitVerificationEmails =
  (client: PgClient): SignInCallback =>
  async ({ account, email }) => {
    if (!email?.verificationRequest) return true;
    // The address the email goes to, which may differ from a matched user's.
    if (!account?.providerAccountId) return false;
    const allowed = await reserveVerificationSend(
      client,
      account.providerAccountId,
    );
    if (!allowed) logInfo("auth.adapter.verification_send_refused");
    return allowed;
  };

type NonNullableProps<T> = {
  [P in keyof T]: null extends T[P] ? never : P;
}[keyof T];

function stripUndefined<T>(obj: T): Pick<T, NonNullableProps<T>> {
  const result = {} as T;
  for (const key in obj) if (obj[key] !== undefined) result[key] = obj[key];
  return result;
}

const getUser = async (
  data: { id: number } | { email: string },
  client: InstanceType<typeof PgDatabase>,
) => {
  logDebug("auth.adapter.get_user", {
    by: "id" in data ? "id" : "email",
  });
  const user = await client
    .select({
      id: users.id,
      email: users.email,
      emailVerified: users.emailVerified,
      editingRegionIds: sql<string[]>`array_agg(${rolesXUsersXOrg.orgId})`,
      roles: sql<
        { orgId: number; orgName: string; roleName: UserRole }[]
      >`COALESCE(
          json_agg(
            json_build_object(
              'orgId', ${schema.orgs.id}, 
              'orgName', ${schema.orgs.name}, 
              'roleName', ${schema.roles.name}
            )
          ) 
          FILTER (
            WHERE ${schema.orgs.id} IS NOT NULL
          ), 
          '[]'
        )`,
    })
    .from(users)
    .leftJoin(rolesXUsersXOrg, eq(users.id, rolesXUsersXOrg.userId))
    .leftJoin(roles, eq(rolesXUsersXOrg.roleId, roles.id))
    .leftJoin(orgs, eq(orgs.id, rolesXUsersXOrg.orgId))
    .where(
      "id" in data
        ? eq(users.id, data.id)
        : ilike(users.email, normalizeEmail(data.email)),
    )
    .groupBy(users.id)
    .then((res) => res[0] ?? null);

  if (!user) return null;

  return {
    ...user,
    editingRegionIds: user.editingRegionIds.map((r) => Number(r)),
    emailVerified: user.emailVerified
      ? dayjs(user.emailVerified).toDate()
      : null,
  };
};

export function MDPGDrizzleAdapter(
  client: InstanceType<typeof PgDatabase>,
): MdAdapter {
  return {
    async createUser(data) {
      logDebug("auth.adapter.create_user", { fields: Object.keys(data) });
      const { id: userId } = await client
        .insert(users)
        .values({
          ...omit(data, "id"),
          email: data.email ? normalizeEmail(data.email) : data.email,
          emailVerified: data.emailVerified?.toISOString(),
        })
        .returning()
        // .onConflictDoNothing()
        .then((res) => res[0]!);

      const user = await getUser({ id: userId }, client);

      if (!user) throw new Error("User not found.");

      return user;
    },
    async getUser(data) {
      logDebug("auth.adapter.get_user", { userId: data });
      return await getUser({ id: data }, client);
    },
    async getUserByEmail(data) {
      logDebug("auth.adapter.get_user_by_email");
      return await getUser({ email: normalizeEmail(data) }, client);
    },
    async createSession(data) {
      logDebug("auth.adapter.create_session", {
        userId: data.userId,
        expires: data.expires,
      });
      const [session] = await client
        .insert(sessions)
        .values({ ...data, expires: data.expires.toISOString() })
        .returning();

      if (!session) throw new Error("Unable to create session");

      return { ...session, expires: new Date(session.expires) };
    },
    async getSessionAndUser(data) {
      logDebug("auth.adapter.get_session_and_user");
      const [session] = await client
        .select()
        .from(sessions)
        .where(eq(sessions.sessionToken, data));
      if (!session) return null;

      const user = await getUser({ id: session.userId }, client);
      if (!user) return null;

      return {
        session: {
          ...session,
          expires: new Date(session.expires),
        },
        user,
      };
    },
    async updateUser(data) {
      logDebug("auth.adapter.update_user", { userId: data.id });
      if (!data.id) {
        throw new Error("No user id.");
      }

      await client
        .update(users)
        .set({
          id: data.id,
          email: data.email,
        })
        .where(eq(users.id, data.id));

      const user = await getUser({ id: data.id }, client);

      if (!user) throw new Error("User not found.");

      return user;
    },
    async updateSession(data) {
      logDebug("auth.adapter.update_session", { expires: data.expires });
      const [session] = await client
        .update(sessions)
        .set({ ...data, expires: data.expires?.toISOString() })
        .where(eq(sessions.sessionToken, data.sessionToken))
        .returning();

      if (!session) throw new Error("Unable to update session");

      return {
        ...session,
        expires: new Date(session.expires),
      };
    },
    async linkAccount(rawAccount) {
      logDebug("auth.adapter.link_account", {
        provider: rawAccount.provider,
        providerAccountId: rawAccount.providerAccountId,
        userId: rawAccount.userId,
      });
      return stripUndefined(
        await client
          .insert(accounts)
          .values(rawAccount)
          // .onConflictDoNothing()
          .returning()
          .then((res) => res[0]!),
      );
    },
    async getUserByAccount(account) {
      logDebug("auth.adapter.get_user_by_account", {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      });
      const userId = await client
        .select({ userId: accounts.userId })
        .from(accounts)
        .where(
          and(
            eq(accounts.providerAccountId, account.providerAccountId),
            eq(accounts.provider, account.provider),
          ),
        )
        .then((res) => res[0]?.userId ?? null);

      if (!userId) return null;

      return await getUser({ id: userId }, client);
    },
    async deleteSession(sessionToken) {
      logDebug("auth.adapter.delete_session");
      const [session] = await client
        .delete(sessions)
        .where(eq(sessions.sessionToken, sessionToken))
        .returning();

      return session
        ? { ...session, expires: new Date(session.expires) }
        : null;
    },
    async createVerificationToken(data) {
      logDebug("auth.adapter.create_verification_token");

      // Normalize email identifier for consistent storage (defensive)
      const identifier = normalizeEmail(data.identifier);

      const token = await client.transaction(async (tx) => {
        await lockIdentifier(tx, identifier);
        // Expired tokens can't sign anyone in.
        await tx
          .delete(verificationTokens)
          .where(
            and(
              eq(verificationTokens.identifier, identifier),
              lte(verificationTokens.expires, utcNow),
            ),
          );
        // Only the newest code or link works.
        await expireLiveTokens(tx, identifier);
        const [created] = await tx
          .insert(verificationTokens)
          .values({
            ...data,
            identifier,
            expires: data.expires.toISOString(),
          })
          .returning();
        return created;
      });

      if (!token) throw new Error("Unable to create token");
      return { ...token, expires: parseUtcTimestamp(token.expires) };
    },
    async useVerificationToken(data) {
      try {
        logDebug("auth.adapter.use_verification_token");
        const normalizedIdentifier = normalizeEmail(data.identifier);

        const token = await client.transaction(async (tx) => {
          await lockIdentifier(tx, normalizedIdentifier);
          // Claim atomically so concurrent callbacks cannot reuse a sign-in token.
          const [match] = await tx
            .delete(verificationTokens)
            .where(
              and(
                eq(verificationTokens.identifier, normalizedIdentifier),
                eq(verificationTokens.token, data.token),
              ),
            )
            .returning();
          // A wrong guess ends the address's live token, so each emailed code
          // allows a single guess.
          if (!match) await expireLiveTokens(tx, normalizedIdentifier);
          return match;
        });

        // Auth.js distinguishes invalid/used tokens from adapter failures.
        return token
          ? { ...token, expires: parseUtcTimestamp(token.expires) }
          : null;
      } catch {
        // Query errors can contain email/token parameters; keep them out of auth logs.
        throw new Error("Unable to consume verification token.");
      }
    },
    async deleteUser(id) {
      logDebug("auth.adapter.delete_user", { id });
      await client.delete(users).where(eq(users.id, id));
    },
    async unlinkAccount(account) {
      logDebug("auth.adapter.unlink_account", {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      });
      const { type, provider, providerAccountId, userId } = await client
        .delete(accounts)
        .where(
          and(
            eq(accounts.providerAccountId, account.providerAccountId),
            eq(accounts.provider, account.provider),
          ),
        )
        .returning()
        .then((res) => res[0]!);

      return { provider, type, providerAccountId, userId };
    },
  };
}

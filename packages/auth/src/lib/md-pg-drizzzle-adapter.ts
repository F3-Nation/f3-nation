import type { PgDatabase } from "drizzle-orm/pg-core";
import type { MdAdapter } from "next-auth";
import dayjs from "dayjs";
import { and, eq } from "drizzle-orm";
import omit from "lodash/omit";

import type { UserRole } from "@acme/shared/app/enums";
import { normalizeEmail } from "@acme/shared/common/functions";
import { ilike } from "drizzle-orm";
import { schema, sql } from "@acme/db";

import { logDebug } from "../logger";

const {
  users,
  roles,
  orgs,
  rolesXUsersXOrg,
  authAccounts: accounts,
  authSessions: sessions,
  authVerificationTokens: verificationTokens,
} = schema;

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
    editingRegionIds: user.editingRegionIds.map((r) => Number(r)) ?? [],
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
      const normalizedData = {
        ...data,
        identifier: normalizeEmail(data.identifier),
        expires: data.expires.toISOString(),
      };

      const [token] = await client
        .insert(verificationTokens)
        .values(normalizedData)
        .returning();

      if (!token) throw new Error("Unable to create token");
      return { ...token, expires: new Date(token.expires) };
    },
    async useVerificationToken(data) {
      try {
        logDebug("auth.adapter.use_verification_token");

        // Normalize email to lowercase for case-insensitive matching
        // Fixes intermittent OTP failures when users type email with different casing
        const normalizedIdentifier = normalizeEmail(data.identifier);

        const [token] = await client
          .select()
          .from(verificationTokens)
          .where(
            and(
              eq(verificationTokens.identifier, normalizedIdentifier),
              eq(verificationTokens.token, data.token),
            ),
          );

        if (!token) throw new Error("No verification token found.");

        return { ...token, expires: new Date(token.expires) };
      } catch {
        throw new Error("No verification token found.");
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

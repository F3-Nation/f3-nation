import type { Adapter, AdapterUser, AdapterSession, VerificationToken } from 'next-auth/adapters';
import { getRepositories, ensureSequenceSynced } from '@/db';
import type { User, Session as DbSession } from '@/db/types';

/**
 * Convert our User entity to NextAuth AdapterUser
 */
function toAdapterUser(user: User): AdapterUser {
  return {
    id: String(user.id),
    email: user.email ?? '',
    emailVerified: user.emailVerified,
    name: user.f3Name,
    image: user.avatarUrl,
  };
}

/**
 * Convert our Session entity to NextAuth AdapterSession
 */
function toAdapterSession(session: DbSession): AdapterSession {
  return {
    sessionToken: session.sessionToken,
    userId: String(session.userId),
    expires: session.expires,
  };
}

/**
 * Create a custom NextAuth adapter using our raw SQL repositories
 */
export function createAdapter(): Adapter {
  const repos = getRepositories();

  return {
    async createUser(user: Omit<AdapterUser, 'id'>) {
      await ensureSequenceSynced();

      const newUser = await repos.users.create({
        email: user.email,
        emailVerified: user.emailVerified ?? undefined,
        f3Name: user.name ?? user.email?.split('@')[0] ?? null,
        status: 'active',
      });

      // Create user profile
      await repos.userProfiles.create({
        userId: newUser.id,
        onboardingCompleted: false,
      });

      return toAdapterUser(newUser);
    },

    async getUser(id) {
      const user = await repos.users.findById(parseInt(id, 10));
      if (!user) return null;
      return toAdapterUser(user);
    },

    async getUserByEmail(email) {
      const user = await repos.users.findByEmail(email);
      if (!user) return null;
      return toAdapterUser(user);
    },

    async getUserByAccount({ providerAccountId, provider }) {
      // This app doesn't use OAuth accounts table (uses custom OAuth flow)
      // Return null as we don't support linked accounts through NextAuth
      void providerAccountId;
      void provider;
      return null;
    },

    async updateUser(user) {
      const id = parseInt(user.id, 10);
      const updated = await repos.users.update(id, {
        email: user.email ?? undefined,
        emailVerified: user.emailVerified ?? undefined,
        f3Name: user.name ?? undefined,
        avatarUrl: user.image ?? undefined,
        updated: new Date(),
      });

      if (!updated) {
        throw new Error(`User with id ${user.id} not found`);
      }

      return toAdapterUser(updated);
    },

    async deleteUser(userId) {
      const id = parseInt(userId, 10);

      // Delete user profile first (FK constraint)
      await repos.userProfiles.delete(id);

      // Delete user
      await repos.users.delete(id);

      return null;
    },

    async linkAccount() {
      // This app doesn't use OAuth accounts table
      return null;
    },

    async unlinkAccount() {
      // This app doesn't use OAuth accounts table
      return undefined;
    },

    async createSession({ sessionToken, userId, expires }) {
      const session = await repos.sessions.create({
        sessionToken,
        userId: parseInt(userId, 10),
        expires,
      });

      return toAdapterSession(session);
    },

    async getSessionAndUser(sessionToken) {
      const session = await repos.sessions.findByToken(sessionToken);
      if (!session) return null;

      // Check if session is expired
      if (session.expires < new Date()) {
        await repos.sessions.delete(sessionToken);
        return null;
      }

      const user = await repos.users.findById(session.userId);
      if (!user) return null;

      return {
        session: toAdapterSession(session),
        user: toAdapterUser(user),
      };
    },

    async updateSession({ sessionToken, expires }) {
      if (!expires) return null;

      const session = await repos.sessions.update(sessionToken, { expires });
      if (!session) return null;

      return toAdapterSession(session);
    },

    async deleteSession(sessionToken) {
      await repos.sessions.delete(sessionToken);
      return null;
    },

    async createVerificationToken({ identifier, expires, token }) {
      const created = await repos.verificationTokens.create({
        identifier,
        token,
        expires,
      });

      return created;
    },

    async useVerificationToken({ identifier, token }): Promise<VerificationToken | null> {
      // Find and delete in one operation (NextAuth expects the token to be consumed)
      const deleted = await repos.verificationTokens.delete(identifier, token);
      return deleted;
    },
  };
}

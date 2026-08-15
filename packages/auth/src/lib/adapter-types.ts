import type { OrgRole } from "@acme/shared/app/types";

type Awaitable<T> = T | PromiseLike<T>;

// Clones of next-auth's adapter models, re-typed with numeric user ids.
export interface VerificationToken {
  /** The user's email address. */
  identifier: string;
  /** The absolute date when the token expires. */
  expires: Date;
  /**
   * A [hashed](https://authjs.dev/concepts/hashing) token, using the `AuthConfig.secret` value.
   */
  token: string;
}

export interface AdapterUser {
  id: number;
  email: string;
  emailVerified: Date | null;
  roles: OrgRole[];
}

export interface AdapterSession {
  userId: number;
  sessionToken: string;
  expires: Date;
}

export interface AdapterAccount {
  userId: number;
  type: string; // Extract<ProviderType, "oauth" | "oidc" | "email" | "webauthn">;
  provider: string;
  providerAccountId: string;
}

/**
 * next-auth's `Adapter`, re-typed with numeric user ids (WebAuthn/passkey
 * methods omitted — unimplemented and out of scope).
 *
 * Deliberately a plain exported interface rather than a `declare module "next-auth"`
 * augmentation: augmentations bind to a resolved file, so a duplicate `next-auth`
 * peer instance detaches them and every member vanishes at once.
 */
export interface MdAdapter {
  /**
   * Creates a user in the database and returns it.
   *
   * See also [User management](https://authjs.dev/guides/adapters/creating-a-database-adapter#user-management)
   */
  createUser?(user: AdapterUser): Awaitable<AdapterUser>;
  /**
   * Returns a user from the database via the user id.
   *
   * See also [User management](https://authjs.dev/guides/adapters/creating-a-database-adapter#user-management)
   */
  getUser?(id: number): Awaitable<AdapterUser | null>;
  /**
   * Returns a user from the database via the user's email address.
   *
   * See also [Verification tokens](https://authjs.dev/guides/adapters/creating-a-database-adapter#verification-tokens)
   */
  getUserByEmail?(email: string): Awaitable<AdapterUser | null>;
  /**
   * Using the provider id and the id of the user for a specific account, get the user.
   *
   * See also [User management](https://authjs.dev/guides/adapters/creating-a-database-adapter#user-management)
   */
  getUserByAccount?(
    providerAccountId: Pick<AdapterAccount, "provider" | "providerAccountId">,
  ): Awaitable<AdapterUser | null>;
  /**
   * Updates a user in the database and returns it.
   *
   * See also [User management](https://authjs.dev/guides/adapters/creating-a-database-adapter#user-management)
   */
  updateUser?(
    user: Partial<AdapterUser> & Pick<AdapterUser, "id">,
  ): Awaitable<AdapterUser>;
  /**
   * @todo This method is currently not invoked yet.
   *
   * See also [User management](https://authjs.dev/guides/adapters/creating-a-database-adapter#user-management)
   */
  deleteUser?(
    userId: number,
  ): Promise<void> | Awaitable<AdapterUser | null | undefined>;
  /**
   * This method is invoked internally (but optionally can be used for manual linking).
   * It creates an [Account](https://authjs.dev/reference/core/adapters#models) in the database.
   *
   * See also [User management](https://authjs.dev/guides/adapters/creating-a-database-adapter#user-management)
   */
  linkAccount?(
    account: AdapterAccount,
  ): Awaitable<AdapterAccount | null | undefined>;
  /** @todo This method is currently not invoked yet. */
  unlinkAccount?(
    providerAccountId: Pick<AdapterAccount, "provider" | "providerAccountId">,
  ): Promise<void> | Awaitable<AdapterAccount | undefined>;
  /**
   * Creates a session for the user and returns it.
   *
   * See also [Database Session management](https://authjs.dev/guides/adapters/creating-a-database-adapter#database-session-management)
   */
  createSession?(session: {
    sessionToken: string;
    userId: number;
    expires: Date;
  }): Awaitable<AdapterSession>;
  /**
   * Returns a session and a userfrom the database in one go.
   *
   * :::tip
   * If the database supports joins, it's recommended to reduce the number of database queries.
   * :::
   *
   * See also [Database Session management](https://authjs.dev/guides/adapters/creating-a-database-adapter#database-session-management)
   */
  getSessionAndUser?(
    sessionToken: string,
  ): Awaitable<{ session: AdapterSession; user: AdapterUser } | null>;
  /**
   * Updates a session in the database and returns it.
   *
   * See also [Database Session management](https://authjs.dev/guides/adapters/creating-a-database-adapter#database-session-management)
   */
  updateSession?(
    session: Partial<AdapterSession> & Pick<AdapterSession, "sessionToken">,
  ): Awaitable<AdapterSession | null | undefined>;
  /**
   * Deletes a session from the database. It is preferred that this method also
   * returns the session that is being deleted for logging purposes.
   *
   * See also [Database Session management](https://authjs.dev/guides/adapters/creating-a-database-adapter#database-session-management)
   */
  deleteSession?(
    sessionToken: string,
  ): Promise<void> | Awaitable<AdapterSession | null | undefined>;
  /**
   * Creates a verification token and returns it.
   *
   * See also [Verification tokens](https://authjs.dev/guides/adapters/creating-a-database-adapter#verification-tokens)
   */
  createVerificationToken?(
    verificationToken: VerificationToken,
  ): Awaitable<VerificationToken | null | undefined>;
  /**
   * Return verification token from the database and deletes it
   * so it can only be used once.
   *
   * See also [Verification tokens](https://authjs.dev/guides/adapters/creating-a-database-adapter#verification-tokens)
   */
  useVerificationToken?(params: {
    identifier: string;
    token: string;
  }): Awaitable<VerificationToken | null>;
  /**
   * Get account by provider account id and provider.
   *
   * If an account is not found, the adapter must return `null`.
   */
  getAccount?(
    providerAccountId: AdapterAccount["providerAccountId"],
    provider: AdapterAccount["provider"],
  ): Awaitable<AdapterAccount | null>;
}

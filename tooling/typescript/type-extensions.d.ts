import type { DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";

type UserRole = "user" | "editor" | "admin";

export type Awaitable<T> = T | PromiseLike<T>;
export type Awaited<T> = T extends Promise<infer U> ? U : T;

// These are clones from next-auth/adapters
interface VerificationToken {
  /** The user's email address. */
  identifier: string;
  /** The absolute date when the token expires. */
  expires: Date;
  /**
   * A [hashed](https://authjs.dev/concepts/hashing) token, using the `AuthConfig.secret` value.
   */
  token: string;
}

type OrgRole = {
  orgId: number;
  orgName: string;
  roleName: UserRole;
};

interface AdapterUser {
  id: number;
  email: string;
  emailVerified: Date | null;
  roles: OrgRole[];
}

interface AdapterSession {
  userId: number;
  sessionToken: string;
  expires: Date;
}

interface AdapterAccount {
  userId: number;
  type: string; // Extract<ProviderType, "oauth" | "oidc" | "email" | "webauthn">;
  provider: string;
  providerAccountId: string;
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string | number;
    email: string | undefined;
    roles: OrgRole[];
    signinunixsecondsepoch: number;
  }
}
/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 * Need separate declaration in @acme/nextjs and @acme/auth
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    id: number;
    email: string | undefined;
    roles?: OrgRole[];
  }

  interface JWT extends DefaultJWT {
    id?: string | number;
    email: string | undefined;
    roles: OrgRole[];
    signinunixsecondsepoch: number;
  }

  interface User {
    // ...other properties
    roles: OrgRole[];
  }

  interface MdAdapter {
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
      // ): Promise<void> | Awaitable<AdapterAccount | null | undefined>;
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
    /**
     * Returns an authenticator from its credentialID.
     *
     * If an authenticator is not found, the adapter must return `null`.
     */
    getAuthenticator?(
      credentialID: AdapterAuthenticator["credentialID"],
    ): Awaitable<AdapterAuthenticator | null>;
    /**
     * Create a new authenticator.
     *
     * If the creation fails, the adapter must throw an error.
     */
    createAuthenticator?(
      authenticator: AdapterAuthenticator,
    ): Awaitable<AdapterAuthenticator>;
    /**
     * Returns all authenticators from a user.
     *
     * If a user is not found, the adapter should still return an empty array.
     * If the retrieval fails for some other reason, the adapter must throw an error.
     */
    listAuthenticatorsByUserId?(
      userId: AdapterAuthenticator["userId"],
    ): Awaitable<AdapterAuthenticator[]>;
    /**
     * Updates an authenticator's counter.
     *
     * If the update fails, the adapter must throw an error.
     */
    updateAuthenticatorCounter?(
      credentialID: AdapterAuthenticator["credentialID"],
      newCounter: AdapterAuthenticator["counter"],
    ): Awaitable<AdapterAuthenticator>;
  }
}

declare module "@tanstack/table-core" {
  interface ColumnMeta {
    // Used in the Header component and in csv
    name?: string;
    excludeFromCsv?: boolean;
  }
}

// https://stackoverflow.com/questions/71099924/cannot-find-module-file-name-png-or-its-corresponding-type-declarations-type
declare global {
  declare module "*.png" {
    const content: string;
    export default content;
  }
  declare module "*.svg" {
    const content: string;
    export default content;
  }
  declare module "*.jpeg" {
    const content: string;
    export default content;
  }
  declare module "*.jpg" {
    const content: string;
    export default content;
  }
  declare module "*.webp" {
    const content: string;
    export default content;
  }
}

declare global {
  interface Window {
    dataLayer: [string, unknown][];
    gtag: (type: "event" | "config", event: string, params: unknown) => void;
  }
}

// Provide a global NoInfer utility type for libraries that reference it in d.ts
// This prevents inference while acting as a passthrough for T
declare global {
  type NoInfer<T> = [T][T extends any ? 0 : never];
}

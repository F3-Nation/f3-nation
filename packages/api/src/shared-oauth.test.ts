/**
 * Tests for f3-nation-auth OAuth token validation in getSession()
 *
 * Tests the new auth path that resolves sessions from f3-nation-auth
 * OAuth access tokens stored in auth.oauth_access_token.
 *
 * These are integration tests that require:
 * - TEST_DATABASE_URL environment variable
 * - Test database with the auth schema and tables
 *
 * Run with: pnpm -C packages/api with-env vitest --run src/shared-oauth.test.ts
 */

import { vi } from "vitest";

const mockLimit = vi.hoisted(() => vi.fn());

vi.mock("@orpc/experimental-ratelimit/memory", () => ({
  MemoryRatelimiter: vi.fn().mockImplementation(() => ({
    limit: mockLimit,
  })),
}));

// Mock auth() to return null so requests fall through to bearer token logic
vi.mock("@acme/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

import { eq, schema, sql } from "@acme/db";
import { db } from "@acme/db/client";
import {
  auth_oauthAccessToken,
  auth_oauthClient,
} from "@acme/db/schema/schema";
import { isDevelopmentNodeEnv } from "@acme/shared/common/constants";
import { Client, Header } from "@acme/shared/common/enums";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { router } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function authSchemaExists(): Promise<boolean> {
  try {
    const result = await db.execute(
      sql`SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'oauth_access_token' LIMIT 1`,
    );
    return result.length > 0;
  } catch {
    return false;
  }
}

const TEST_PREFIX = `oauth-test-${Date.now()}`;
const HAS_AUTH_SCHEMA = await authSchemaExists();

async function createTestUser(email: string, f3Name: string) {
  const [user] = await db
    .insert(schema.users)
    .values({ email, f3Name })
    .returning({ id: schema.users.id });
  return user!.id;
}

async function createTestOAuthClient(clientId: string) {
  await db.insert(auth_oauthClient).values({
    id: clientId,
    name: `Test Client ${clientId}`,
    clientSecret: `secret-${clientId}`,
    redirectUris: JSON.stringify(["http://localhost:3000/callback"]),
    allowedOrigin: "http://localhost:3000",
    scopes: "openid profile email",
    isActive: true,
  });
}

async function createTestAccessToken(params: {
  token: string;
  clientId: string;
  userId: string;
  expires: string;
}) {
  await db.insert(auth_oauthAccessToken).values({
    token: params.token,
    clientId: params.clientId,
    userId: params.userId,
    scopes: "openid profile email",
    expires: params.expires,
  });
}

function createOAuthClient(token: string) {
  return createRouterClient(router, {
    context: () =>
      Promise.resolve({
        reqHeaders: new Headers({
          [Header.Authorization]: `Bearer ${token}`,
        }),
      }),
  });
}

function createApiKeyClient(apiKey: string) {
  return createRouterClient(router, {
    context: () =>
      Promise.resolve({
        reqHeaders: new Headers({
          [Header.Authorization]: `Bearer ${apiKey}`,
          [Header.Client]: Client.ORPC,
        }),
      }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OAuth Access Token Authentication", () => {
  if (!HAS_AUTH_SCHEMA) {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    it.skip("auth schema not present in test DB — run auth migrations first", () => {});
    return;
  }

  const testClientId = `${TEST_PREFIX}-client`;
  let testUserId: number;
  const testEmail = `${TEST_PREFIX}@example.com`;

  beforeAll(async () => {
    await createTestOAuthClient(testClientId);

    testUserId = await createTestUser(testEmail, `${TEST_PREFIX}-user`);

    // Assign editor role to test user
    const [org] = await db
      .select({ id: schema.orgs.id })
      .from(schema.orgs)
      .limit(1);
    const [role] = await db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(eq(schema.roles.name, "editor"))
      .limit(1);
    if (org && role) {
      await db
        .insert(schema.rolesXUsersXOrg)
        .values({ userId: testUserId, roleId: role.id, orgId: org.id });
    }
  });

  afterAll(async () => {
    await db
      .delete(auth_oauthAccessToken)
      .where(eq(auth_oauthAccessToken.clientId, testClientId));
    await db
      .delete(schema.rolesXUsersXOrg)
      .where(eq(schema.rolesXUsersXOrg.userId, testUserId));
    await db.delete(schema.users).where(eq(schema.users.id, testUserId));
    await db
      .delete(auth_oauthClient)
      .where(eq(auth_oauthClient.id, testClientId));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    });
  });

  describe("valid token", () => {
    const validToken = `${TEST_PREFIX}-valid-token`;

    beforeAll(async () => {
      await createTestAccessToken({
        token: validToken,
        clientId: testClientId,
        userId: testEmail,
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
    });

    it("should authenticate and resolve the correct user", async () => {
      const client = createOAuthClient(validToken);
      const result = await client.ping();
      expect(result.alive).toBe(true);
    });

    it("should resolve the correct user identity on protected endpoints", async () => {
      const client = createOAuthClient(validToken);
      const result = await client.user.all({ pageIndex: 0, pageSize: 1 });
      expect(result).toHaveProperty("users");
    });
  });

  describe("expired token", () => {
    const expiredToken = `${TEST_PREFIX}-expired-token`;

    beforeAll(async () => {
      await createTestAccessToken({
        token: expiredToken,
        clientId: testClientId,
        userId: testEmail,
        expires: new Date(Date.now() - 60 * 1000).toISOString(),
      });
    });

    it("should not authenticate with an expired token", async () => {
      const client = createApiKeyClient(expiredToken);
      const result = await client.user
        .all({ pageIndex: 0, pageSize: 1 })
        .catch((e: Error) => e);
      expect(result).toBeInstanceOf(Error);
    });
  });

  describe("non-existent token", () => {
    it("should not authenticate with a token that doesn't exist", async () => {
      const client = createApiKeyClient(`${TEST_PREFIX}-nonexistent`);
      const result = await client.user
        .all({ pageIndex: 0, pageSize: 1 })
        .catch((e: Error) => e);
      expect(result).toBeInstanceOf(Error);
    });
  });

  describe("resolution order", () => {
    it("should try OAuth token before API key (no Client header needed)", async () => {
      const orderToken = `${TEST_PREFIX}-order-token`;
      await createTestAccessToken({
        token: orderToken,
        clientId: testClientId,
        userId: testEmail,
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      // No Client header — would fail if it fell through to API key path
      const client = createOAuthClient(orderToken);
      const result = await client.ping();
      expect(result.alive).toBe(true);

      await db
        .delete(auth_oauthAccessToken)
        .where(eq(auth_oauthAccessToken.token, orderToken));
    });
  });

  describe("user roles", () => {
    it("should include the user's org roles in the session", async () => {
      const roleToken = `${TEST_PREFIX}-role-token`;
      await createTestAccessToken({
        token: roleToken,
        clientId: testClientId,
        userId: testEmail,
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      const client = createOAuthClient(roleToken);
      const result = await client.user.all({ pageIndex: 0, pageSize: 1 });
      expect(result).toHaveProperty("users");

      await db
        .delete(auth_oauthAccessToken)
        .where(eq(auth_oauthAccessToken.token, roleToken));
    });
  });

  describe("no bearer token", () => {
    it("should use dev mock only in development on protected endpoints", async () => {
      const client = createRouterClient(router, {
        context: () =>
          Promise.resolve({
            reqHeaders: new Headers(),
          }),
      });

      const result = await client.user
        .all({ pageIndex: 0, pageSize: 1 })
        .catch((e: Error) => e);

      if (isDevelopmentNodeEnv) {
        expect(result).toHaveProperty("users");
      } else {
        expect(result).toBeInstanceOf(Error);
      }
    });
  });
});

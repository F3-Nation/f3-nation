/**
 * Tests for the oauth-client router.
 *
 * Requires TEST_DATABASE_URL to point at a migrated test database (the
 * better_auth_oauth_client table comes from packages/db/drizzle's own
 * migrations, not a separately-applied step).
 */

import { authSchema, eq } from "@acme/db";
import { db } from "@acme/db/client";
import type { Session } from "@acme/auth";
import { F3_NATION_ORG_ID } from "@acme/shared/app/constants";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAdminSession,
  createNoPermissionSession,
  createTestClient,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

// isNationAdminFromSession (packages/shared/src/app/role-checks.ts) checks the
// session's roles directly — orgId === F3_NATION_ORG_ID and orgName containing
// "f3 nation" — rather than re-querying the orgs table, so the session can
// carry that literal orgName regardless of what the seeded nation org (id 1,
// named "Test Nation" — see packages/api/src/testing/index.ts) is called.
function createNationAdminSession(): Session {
  return {
    id: 1,
    email: "nation-admin@example.com",
    user: {
      id: "1",
      email: "nation-admin@example.com",
      name: "Nation Admin",
      roles: [
        { orgId: F3_NATION_ORG_ID, orgName: "F3 Nation", roleName: "admin" },
      ],
    },
    roles: [
      { orgId: F3_NATION_ORG_ID, orgName: "F3 Nation", roleName: "admin" },
    ],
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  };
}

async function insertTestClient(overrides: {
  clientId: string;
  clientSecret?: string | null;
  name?: string | null;
  redirectUris?: string[];
  scopes?: string[] | null;
  tokenEndpointAuthMethod?: string | null;
  disabled?: boolean | null;
}) {
  const [row] = await db
    .insert(authSchema.betterAuthOauthClient)
    .values({
      id: overrides.clientId,
      clientId: overrides.clientId,
      clientSecret: overrides.clientSecret ?? "super-secret-hash",
      name: overrides.name ?? "Test Client",
      redirectUris: overrides.redirectUris ?? ["https://example.test/callback"],
      scopes: overrides.scopes ?? ["openid"],
      tokenEndpointAuthMethod:
        overrides.tokenEndpointAuthMethod ?? "client_secret_basic",
      disabled: overrides.disabled ?? false,
    })
    .returning();

  if (!row) throw new Error("Failed to insert test OAuth client");
  return row;
}

describe("oauth-client router", () => {
  const createdClientIds: string[] = [];

  afterEach(async () => {
    for (const clientId of createdClientIds.splice(0)) {
      await db
        .delete(authSchema.betterAuthOauthClient)
        .where(eq(authSchema.betterAuthOauthClient.clientId, clientId));
    }
  });

  describe("authorization", () => {
    it("rejects list for a non-nation-admin", async () => {
      await mockAuthWithSession(await createAdminSession());
      const client = createTestClient();

      await expect(client.oauthClient.list()).rejects.toThrow();
    });

    it("rejects list for a session with no permissions", async () => {
      await mockAuthWithSession(createNoPermissionSession());
      const client = createTestClient();

      await expect(client.oauthClient.list()).rejects.toThrow();
    });

    it("rejects update for a non-nation-admin", async () => {
      const clientId = `oauth-client-test-${uniqueId()}`;
      createdClientIds.push(clientId);
      await insertTestClient({ clientId });

      await mockAuthWithSession(await createAdminSession());
      const client = createTestClient();

      await expect(
        client.oauthClient.update({ clientId, disabled: true }),
      ).rejects.toThrow();
    });
  });

  describe("list", () => {
    it("returns registered clients without ever including the client secret", async () => {
      const clientId = `oauth-client-test-${uniqueId()}`;
      createdClientIds.push(clientId);
      await insertTestClient({
        clientId,
        clientSecret: "should-never-be-returned",
        tokenEndpointAuthMethod: "client_secret_basic",
      });

      await mockAuthWithSession(createNationAdminSession());
      const client = createTestClient();

      const result = await client.oauthClient.list();
      const found = result.clients.find((c) => c.clientId === clientId);

      expect(found).toBeDefined();
      expect(found?.isPublic).toBe(false);
      expect(found).not.toHaveProperty("clientSecret");
      expect(JSON.stringify(found)).not.toContain("should-never-be-returned");
    });

    it("derives isPublic from a PKCE-only token endpoint auth method", async () => {
      const clientId = `oauth-client-test-${uniqueId()}`;
      createdClientIds.push(clientId);
      await insertTestClient({ clientId, tokenEndpointAuthMethod: "none" });

      await mockAuthWithSession(createNationAdminSession());
      const client = createTestClient();

      const result = await client.oauthClient.list();
      const found = result.clients.find((c) => c.clientId === clientId);

      expect(found?.isPublic).toBe(true);
    });
  });

  describe("update", () => {
    it("updates name, redirect URIs, scopes, and disabled state", async () => {
      const clientId = `oauth-client-test-${uniqueId()}`;
      createdClientIds.push(clientId);
      await insertTestClient({ clientId });

      await mockAuthWithSession(createNationAdminSession());
      const client = createTestClient();

      const result = await client.oauthClient.update({
        clientId,
        name: "Renamed Client",
        redirectUris: ["https://example.test/new-callback"],
        scopes: ["openid", "profile"],
        disabled: true,
      });

      expect(result.client.name).toBe("Renamed Client");
      expect(result.client.redirectUris).toEqual([
        "https://example.test/new-callback",
      ]);
      expect(result.client.scopes).toEqual(["openid", "profile"]);
      expect(result.client.disabled).toBe(true);
      expect(result.client).not.toHaveProperty("clientSecret");
    });

    it("throws for a nonexistent client", async () => {
      await mockAuthWithSession(createNationAdminSession());
      const client = createTestClient();

      await expect(
        client.oauthClient.update({
          clientId: `nonexistent-${uniqueId()}`,
          disabled: true,
        }),
      ).rejects.toThrow();
    });

    it("requires at least one field to update", async () => {
      const clientId = `oauth-client-test-${uniqueId()}`;
      createdClientIds.push(clientId);
      await insertTestClient({ clientId });

      await mockAuthWithSession(createNationAdminSession());
      const client = createTestClient();

      await expect(client.oauthClient.update({ clientId })).rejects.toThrow();
    });
  });
});

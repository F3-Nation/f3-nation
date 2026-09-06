/**
 * Tests for the oauth-client router.
 *
 * Requires TEST_DATABASE_URL to point at a migrated test database (the
 * better_auth_oauth_client table comes from packages/db/drizzle's own
 * migrations, not a separately-applied step).
 */

import { and, authSchema, eq, schema } from "@acme/db";
import { db } from "@acme/db/client";
import type { Session } from "@acme/auth";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAdminSession,
  createNoPermissionSession,
  createTestClient,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

async function createNationAdminSession(): Promise<Session> {
  let [f3Nation] = await db
    .select({ id: schema.orgs.id })
    .from(schema.orgs)
    .where(
      and(eq(schema.orgs.orgType, "nation"), eq(schema.orgs.name, "F3 Nation")),
    )
    .limit(1);

  if (!f3Nation) {
    const [created] = await db
      .insert(schema.orgs)
      .values({ name: "F3 Nation", orgType: "nation", isActive: true })
      .returning();
    f3Nation = created;
  }

  if (!f3Nation) throw new Error("F3 Nation org not found");

  return {
    id: 1,
    email: "nation-admin@example.com",
    user: {
      id: "1",
      email: "nation-admin@example.com",
      name: "Nation Admin",
      roles: [{ orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" }],
    },
    roles: [{ orgId: f3Nation.id, orgName: "F3 Nation", roleName: "admin" }],
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

      await mockAuthWithSession(await createNationAdminSession());
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

      await mockAuthWithSession(await createNationAdminSession());
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

      await mockAuthWithSession(await createNationAdminSession());
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
      await mockAuthWithSession(await createNationAdminSession());
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

      await mockAuthWithSession(await createNationAdminSession());
      const client = createTestClient();

      await expect(client.oauthClient.update({ clientId })).rejects.toThrow();
    });
  });
});

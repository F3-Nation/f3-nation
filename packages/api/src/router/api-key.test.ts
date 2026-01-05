/**
 * Tests for API Key Router endpoints
 *
 * These tests require:
 * - TEST_DATABASE_URL environment variable to be set
 * - Test database to be seeded with test data
 */

import { eq, schema } from "@acme/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  createAdminSession,
  createTestClient,
  db,
  getOrCreateF3NationOrg,
  mockAuthWithSession,
  uniqueId,
} from "../__tests__/test-utils";

describe("API Key Router", () => {
  // Track created API keys for cleanup
  const createdApiKeyIds: number[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Clean up all created API keys
    for (const apiKeyId of createdApiKeyIds.reverse()) {
      try {
        await cleanup.apiKey(apiKeyId);
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  describe("list", () => {
    it("should return a list of API keys", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const result = await client.apiKey.list();

      expect(result).toHaveProperty("apiKeys");
      expect(Array.isArray(result.apiKeys)).toBe(true);
    });

    it("should include key signature (last 4 chars)", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      // Create an API key first
      const client = createTestClient();
      const createResult = await client.apiKey.create({
        name: `List Test ${uniqueId()}`,
      });

      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      const result = await client.apiKey.list();

      // Check that keys have signature
      if (result.apiKeys.length > 0) {
        const key = result.apiKeys.find((k) => k.id === createResult.id);
        expect(key).toBeDefined();
        expect(key?.keySignature).toBeDefined();
        expect(key?.keySignature?.length).toBe(4);
      }
    });
  });

  describe("create", () => {
    it("should create an API key with name only", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const keyName = `Test API Key ${uniqueId()}`;

      const result = await client.apiKey.create({
        name: keyName,
      });

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("secret");
      expect(result.name).toBe(keyName);
      expect(result.secret).toMatch(/^f3_/); // API keys start with f3_

      if (result.id) {
        createdApiKeyIds.push(result.id);
      }
    });

    it("should create an API key with description", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const keyName = `Test API Key ${uniqueId()}`;
      const description = "Test description for API key";

      const result = await client.apiKey.create({
        name: keyName,
        description,
      });

      expect(result.name).toBe(keyName);
      expect(result.description).toBe(description);

      if (result.id) {
        createdApiKeyIds.push(result.id);
      }
    });

    it("should create an API key with roles", async () => {
      const nationOrg = await getOrCreateF3NationOrg();
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const keyName = `Test API Key with Roles ${uniqueId()}`;

      const result = await client.apiKey.create({
        name: keyName,
        roles: [
          {
            orgId: nationOrg.id,
            roleName: "editor",
          },
        ],
      });

      expect(result).toHaveProperty("id");
      expect(result.name).toBe(keyName);

      if (result.id) {
        createdApiKeyIds.push(result.id);
      }

      // Verify the role was created
      const listResult = await client.apiKey.list();
      const createdKey = listResult.apiKeys.find((k) => k.id === result.id);
      expect(createdKey?.roles?.length).toBeGreaterThan(0);
    });

    it("should create an API key with expiration date", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();
      const keyName = `Expiring API Key ${uniqueId()}`;
      const expiresAt = new Date(
        Date.now() + 1000 * 60 * 60 * 24 * 30,
      ).toISOString(); // 30 days from now

      const result = await client.apiKey.create({
        name: keyName,
        expiresAt,
      });

      expect(result.name).toBe(keyName);
      expect(result.expiresAt).toBeDefined();

      if (result.id) {
        createdApiKeyIds.push(result.id);
      }
    });

    it("should require a name", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.apiKey.create({
          name: "",
        }),
      ).rejects.toThrow();
    });
  });

  describe("revoke", () => {
    it("should revoke an API key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an API key first
      const createResult = await client.apiKey.create({
        name: `Revoke Test ${uniqueId()}`,
      });

      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      // Revoke it
      const result = await client.apiKey.revoke({
        id: createResult.id,
        revoke: true,
      });

      expect(result.apiKey).toBeDefined();
      expect(result.apiKey?.revokedAt).toBeDefined();
    });

    it("should restore a revoked API key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create and revoke an API key
      const createResult = await client.apiKey.create({
        name: `Restore Test ${uniqueId()}`,
      });

      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      await client.apiKey.revoke({
        id: createResult.id,
        revoke: true,
      });

      // Restore it
      const result = await client.apiKey.revoke({
        id: createResult.id,
        revoke: false,
      });

      expect(result.apiKey?.revokedAt).toBeNull();
    });

    it("should throw for non-existent key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.apiKey.revoke({
          id: 999999,
          revoke: true,
        }),
      ).rejects.toThrow();
    });
  });

  describe("purge", () => {
    it("should permanently delete an API key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an API key first
      const createResult = await client.apiKey.create({
        name: `Purge Test ${uniqueId()}`,
      });

      const keyId = createResult.id;

      // Purge it
      const result = await client.apiKey.purge({
        id: keyId,
      });

      expect(result.apiKey).toBeDefined();
      expect(result.apiKey?.id).toBe(keyId);

      // Verify it's gone
      const [deletedKey] = await db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.id, keyId));

      expect(deletedKey).toBeUndefined();

      // Don't add to cleanup since it's already deleted
    });

    it("should throw for non-existent key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      await expect(
        client.apiKey.purge({
          id: 999999,
        }),
      ).rejects.toThrow();
    });
  });

  describe("validate", () => {
    it("should return true for valid API key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an API key first
      const createResult = await client.apiKey.create({
        name: `Validate Test ${uniqueId()}`,
      });

      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      // Validate it
      const result = await client.apiKey.validate({
        key: createResult.secret,
      });

      expect(result.isValid).toBe(true);
    });

    it("should return false for non-existent key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      const result = await client.apiKey.validate({
        key: "f3_nonexistent_key_12345",
      });

      expect(result.isValid).toBe(false);
    });

    it("should return false for revoked key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create and revoke an API key
      const createResult = await client.apiKey.create({
        name: `Validate Revoked Test ${uniqueId()}`,
      });

      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      await client.apiKey.revoke({
        id: createResult.id,
        revoke: true,
      });

      // Validate it
      const result = await client.apiKey.validate({
        key: createResult.secret,
      });

      expect(result.isValid).toBe(false);
    });

    it("should return false for expired key", async () => {
      const session = await createAdminSession();
      await mockAuthWithSession(session);

      const client = createTestClient();

      // Create an API key that's already expired
      const expiredDate = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
      const createResult = await client.apiKey.create({
        name: `Validate Expired Test ${uniqueId()}`,
        expiresAt: expiredDate,
      });

      if (createResult.id) {
        createdApiKeyIds.push(createResult.id);
      }

      // Validate it
      const result = await client.apiKey.validate({
        key: createResult.secret,
      });

      expect(result.isValid).toBe(false);
    });
  });
});

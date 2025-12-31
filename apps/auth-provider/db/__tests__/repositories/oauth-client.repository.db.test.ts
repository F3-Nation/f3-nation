import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  getTestRepositories,
} from '@/test/utils/test-database';
import {
  createOAuthClientData,
  createOAuthClientDataWithMultipleRedirects,
  resetOAuthClientCounter,
} from '@/test/utils/factories';

describe('OAuthClientRepository', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
    resetOAuthClientCounter();
  });

  describe('create', () => {
    it('should create an OAuth client and return entity', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData();

      const client = await repos.oauthClients.create(clientData);

      expect(client).toBeDefined();
      expect(client.id).toBe(clientData.id);
      expect(client.name).toBe(clientData.name);
      expect(client.clientSecret).toBe(clientData.clientSecret);
      expect(client.redirectUris).toBe(clientData.redirectUris);
      expect(client.allowedOrigin).toBe(clientData.allowedOrigin);
      expect(client.scopes).toBe('openid profile email');
      expect(client.isActive).toBe(true);
      expect(client.createdAt).toBeDefined();
    });

    it('should create an OAuth client with multiple redirect URIs', async () => {
      const repos = getTestRepositories();
      const redirectUris = [
        'http://localhost:3001/callback',
        'http://localhost:3001/auth/callback',
        'https://example.com/callback',
      ];
      const clientData = createOAuthClientDataWithMultipleRedirects(redirectUris);

      const client = await repos.oauthClients.create(clientData);

      expect(client.redirectUris).toBe(JSON.stringify(redirectUris));
    });

    it('should create an inactive OAuth client', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData({ isActive: false });

      const client = await repos.oauthClients.create(clientData);

      expect(client.isActive).toBe(false);
    });

    it('should throw error when creating client with duplicate ID', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData();

      await repos.oauthClients.create(clientData);

      await expect(repos.oauthClients.create(clientData)).rejects.toThrow();
    });
  });

  describe('findById', () => {
    it('should find an OAuth client by ID', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData();
      await repos.oauthClients.create(clientData);

      const found = await repos.oauthClients.findById(clientData.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(clientData.id);
      expect(found?.name).toBe(clientData.name);
    });

    it('should return null for non-existent ID', async () => {
      const repos = getTestRepositories();

      const found = await repos.oauthClients.findById('non-existent-client');

      expect(found).toBeNull();
    });

    it('should find inactive clients with findById', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData({ isActive: false });
      await repos.oauthClients.create(clientData);

      const found = await repos.oauthClients.findById(clientData.id);

      expect(found).toBeDefined();
      expect(found?.isActive).toBe(false);
    });
  });

  describe('findActiveById', () => {
    it('should find an active OAuth client by ID', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData({ isActive: true });
      await repos.oauthClients.create(clientData);

      const found = await repos.oauthClients.findActiveById(clientData.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(clientData.id);
      expect(found?.isActive).toBe(true);
    });

    it('should return null for inactive client', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData({ isActive: false });
      await repos.oauthClients.create(clientData);

      const found = await repos.oauthClients.findActiveById(clientData.id);

      expect(found).toBeNull();
    });

    it('should return null for non-existent client', async () => {
      const repos = getTestRepositories();

      const found = await repos.oauthClients.findActiveById('non-existent-client');

      expect(found).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should find all OAuth clients', async () => {
      const repos = getTestRepositories();

      await repos.oauthClients.create(createOAuthClientData());
      await repos.oauthClients.create(createOAuthClientData());
      await repos.oauthClients.create(createOAuthClientData({ isActive: false }));

      const clients = await repos.oauthClients.findAll();

      expect(clients).toHaveLength(3);
    });

    it('should return clients ordered by created_at DESC', async () => {
      const repos = getTestRepositories();

      const clientData1 = createOAuthClientData();
      await repos.oauthClients.create(clientData1);

      await new Promise(resolve => setTimeout(resolve, 10));

      const clientData2 = createOAuthClientData();
      await repos.oauthClients.create(clientData2);

      const clients = await repos.oauthClients.findAll();

      expect(clients).toHaveLength(2);
      expect(clients[0].id).toBe(clientData2.id); // Most recent first
    });

    it('should return empty array when no clients exist', async () => {
      const repos = getTestRepositories();

      const clients = await repos.oauthClients.findAll();

      expect(clients).toHaveLength(0);
    });
  });

  describe('findAllActive', () => {
    it('should find only active OAuth clients', async () => {
      const repos = getTestRepositories();

      await repos.oauthClients.create(createOAuthClientData({ isActive: true }));
      await repos.oauthClients.create(createOAuthClientData({ isActive: true }));
      await repos.oauthClients.create(createOAuthClientData({ isActive: false }));

      const clients = await repos.oauthClients.findAllActive();

      expect(clients).toHaveLength(2);
      clients.forEach(client => {
        expect(client.isActive).toBe(true);
      });
    });

    it('should return empty array when no active clients exist', async () => {
      const repos = getTestRepositories();

      await repos.oauthClients.create(createOAuthClientData({ isActive: false }));

      const clients = await repos.oauthClients.findAllActive();

      expect(clients).toHaveLength(0);
    });
  });

  describe('update', () => {
    it('should update OAuth client with partial data', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData();
      await repos.oauthClients.create(clientData);

      const updated = await repos.oauthClients.update(clientData.id, {
        name: 'Updated Client Name',
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('Updated Client Name');
      expect(updated?.clientSecret).toBe(clientData.clientSecret);
    });

    it('should update multiple fields', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData();
      await repos.oauthClients.create(clientData);

      const newRedirectUris = JSON.stringify(['https://newsite.com/callback']);
      const updated = await repos.oauthClients.update(clientData.id, {
        name: 'New Name',
        redirectUris: newRedirectUris,
        allowedOrigin: 'https://newsite.com',
        scopes: 'openid profile',
      });

      expect(updated?.name).toBe('New Name');
      expect(updated?.redirectUris).toBe(newRedirectUris);
      expect(updated?.allowedOrigin).toBe('https://newsite.com');
      expect(updated?.scopes).toBe('openid profile');
    });

    it('should return null when updating non-existent client', async () => {
      const repos = getTestRepositories();

      const updated = await repos.oauthClients.update('non-existent-client', {
        name: 'New Name',
      });

      expect(updated).toBeNull();
    });

    it('should return existing client when updating with empty data', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData();
      await repos.oauthClients.create(clientData);

      const updated = await repos.oauthClients.update(clientData.id, {});

      expect(updated).toBeDefined();
      expect(updated?.id).toBe(clientData.id);
      expect(updated?.name).toBe(clientData.name);
    });
  });

  describe('delete', () => {
    it('should delete an OAuth client and return true', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData();
      await repos.oauthClients.create(clientData);

      const deleted = await repos.oauthClients.delete(clientData.id);

      expect(deleted).toBe(true);

      const found = await repos.oauthClients.findById(clientData.id);
      expect(found).toBeNull();
    });

    it('should return false when deleting non-existent client', async () => {
      const repos = getTestRepositories();

      const deleted = await repos.oauthClients.delete('non-existent-client');

      expect(deleted).toBe(false);
    });
  });

  describe('deactivate', () => {
    it('should deactivate an active OAuth client', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData({ isActive: true });
      await repos.oauthClients.create(clientData);

      const deactivated = await repos.oauthClients.deactivate(clientData.id);

      expect(deactivated).toBeDefined();
      expect(deactivated?.isActive).toBe(false);

      const found = await repos.oauthClients.findActiveById(clientData.id);
      expect(found).toBeNull();
    });

    it('should return null when deactivating non-existent client', async () => {
      const repos = getTestRepositories();

      const deactivated = await repos.oauthClients.deactivate('non-existent-client');

      expect(deactivated).toBeNull();
    });

    it('should not change other fields when deactivating', async () => {
      const repos = getTestRepositories();
      const clientData = createOAuthClientData({ isActive: true });
      await repos.oauthClients.create(clientData);

      const deactivated = await repos.oauthClients.deactivate(clientData.id);

      expect(deactivated?.name).toBe(clientData.name);
      expect(deactivated?.clientSecret).toBe(clientData.clientSecret);
      expect(deactivated?.redirectUris).toBe(clientData.redirectUris);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { encode } from 'base64-url';
import {
  generateSecureToken,
  validateRedirectUri,
  validateScopes,
  generateAuthorizationState,
  validateAuthorizationState,
  type OAuthClient,
} from '../oauth';
import { decodeState } from '../state-utils';

describe('oauth', () => {
  describe('generateSecureToken', () => {
    it('generates a string token', () => {
      const token = generateSecureToken();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('generates tokens of correct length for default (32 bytes)', () => {
      const token = generateSecureToken();
      // 32 bytes in base64url = approximately 43 characters
      expect(token.length).toBeGreaterThanOrEqual(40);
    });

    it('generates tokens of specified length', () => {
      const token16 = generateSecureToken(16);
      const token64 = generateSecureToken(64);

      // 16 bytes in base64url ≈ 22 characters
      // 64 bytes in base64url ≈ 86 characters
      expect(token16.length).toBeLessThan(token64.length);
    });

    it('generates URL-safe base64 tokens', () => {
      // Generate many tokens to ensure URL safety
      for (let i = 0; i < 20; i++) {
        const token = generateSecureToken();
        // base64url should not contain +, /, or = characters
        expect(token).not.toMatch(/[+/=]/);
      }
    });

    it('generates unique tokens', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateSecureToken());
      }
      // All 100 tokens should be unique
      expect(tokens.size).toBe(100);
    });

    it('generates cryptographically random tokens', () => {
      const token1 = generateSecureToken();
      const token2 = generateSecureToken();

      expect(token1).not.toBe(token2);
    });
  });

  describe('validateRedirectUri', () => {
    const mockClient: OAuthClient = {
      id: 'client123',
      name: 'Test Client',
      clientSecret: 'secret',
      redirectUris: ['https://app.example.com/callback', 'https://app.example.com/oauth/callback'],
      scopes: ['openid', 'profile', 'email'],
      createdAt: new Date(),
      isActive: true,
    };

    it('returns true for valid redirect URI', () => {
      const result = validateRedirectUri(mockClient, 'https://app.example.com/callback');
      expect(result).toBe(true);
    });

    it('returns true for second valid redirect URI', () => {
      const result = validateRedirectUri(mockClient, 'https://app.example.com/oauth/callback');
      expect(result).toBe(true);
    });

    it('returns false for invalid redirect URI', () => {
      const result = validateRedirectUri(mockClient, 'https://evil.com/callback');
      expect(result).toBe(false);
    });

    it('returns false for partial match', () => {
      const result = validateRedirectUri(mockClient, 'https://app.example.com/callback/extra');
      expect(result).toBe(false);
    });

    it('returns false for different protocol', () => {
      const result = validateRedirectUri(mockClient, 'http://app.example.com/callback');
      expect(result).toBe(false);
    });

    it('returns false for empty redirect URI', () => {
      const result = validateRedirectUri(mockClient, '');
      expect(result).toBe(false);
    });

    it('handles client with single redirect URI', () => {
      const singleUriClient: OAuthClient = {
        ...mockClient,
        redirectUris: ['https://single.example.com/callback'],
      };

      expect(validateRedirectUri(singleUriClient, 'https://single.example.com/callback')).toBe(
        true
      );
      expect(validateRedirectUri(singleUriClient, 'https://other.example.com/callback')).toBe(
        false
      );
    });

    it('handles client with no redirect URIs', () => {
      const noUriClient: OAuthClient = {
        ...mockClient,
        redirectUris: [],
      };

      expect(validateRedirectUri(noUriClient, 'https://app.example.com/callback')).toBe(false);
    });

    it('is case-sensitive for URIs', () => {
      const result = validateRedirectUri(mockClient, 'https://APP.EXAMPLE.COM/callback');
      expect(result).toBe(false);
    });
  });

  describe('validateScopes', () => {
    const mockClient: OAuthClient = {
      id: 'client123',
      name: 'Test Client',
      clientSecret: 'secret',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid', 'profile', 'email', 'custom:read'],
      createdAt: new Date(),
      isActive: true,
    };

    it('returns true when all requested scopes are allowed', () => {
      const result = validateScopes(mockClient, ['openid', 'profile']);
      expect(result).toBe(true);
    });

    it('returns true for single valid scope', () => {
      const result = validateScopes(mockClient, ['email']);
      expect(result).toBe(true);
    });

    it('returns true for all allowed scopes', () => {
      const result = validateScopes(mockClient, ['openid', 'profile', 'email', 'custom:read']);
      expect(result).toBe(true);
    });

    it('returns true for empty requested scopes', () => {
      const result = validateScopes(mockClient, []);
      expect(result).toBe(true);
    });

    it('returns false when any requested scope is not allowed', () => {
      const result = validateScopes(mockClient, ['openid', 'admin']);
      expect(result).toBe(false);
    });

    it('returns false for completely unauthorized scope', () => {
      const result = validateScopes(mockClient, ['admin']);
      expect(result).toBe(false);
    });

    it('returns false when requesting more scopes than allowed', () => {
      const result = validateScopes(mockClient, [
        'openid',
        'profile',
        'email',
        'custom:read',
        'custom:write',
      ]);
      expect(result).toBe(false);
    });

    it('handles client with minimal scopes', () => {
      const minimalClient: OAuthClient = {
        ...mockClient,
        scopes: ['openid'],
      };

      expect(validateScopes(minimalClient, ['openid'])).toBe(true);
      expect(validateScopes(minimalClient, ['profile'])).toBe(false);
    });

    it('handles client with no allowed scopes', () => {
      const noScopeClient: OAuthClient = {
        ...mockClient,
        scopes: [],
      };

      expect(validateScopes(noScopeClient, [])).toBe(true);
      expect(validateScopes(noScopeClient, ['openid'])).toBe(false);
    });

    it('is case-sensitive for scope names', () => {
      const result = validateScopes(mockClient, ['OPENID']);
      expect(result).toBe(false);
    });
  });

  describe('generateAuthorizationState', () => {
    it('returns a non-empty string', () => {
      const state = generateAuthorizationState('csrf123');
      expect(typeof state).toBe('string');
      expect(state.length).toBeGreaterThan(0);
    });

    it('encodes csrfToken in state', () => {
      const csrfToken = 'test-csrf-token-123';
      const state = generateAuthorizationState(csrfToken);
      const decoded = decodeState(state);

      expect(decoded.csrfToken).toBe(csrfToken);
    });

    it('includes clientId when provided', () => {
      const state = generateAuthorizationState('csrf', 'client123');
      const decoded = decodeState(state);

      expect(decoded.csrfToken).toBe('csrf');
      expect(decoded.clientId).toBe('client123');
    });

    it('includes returnTo when provided', () => {
      const state = generateAuthorizationState('csrf', undefined, '/dashboard');
      const decoded = decodeState(state);

      expect(decoded.csrfToken).toBe('csrf');
      expect(decoded.returnTo).toBe('/dashboard');
    });

    it('includes all parameters when all are provided', () => {
      const state = generateAuthorizationState('csrf456', 'myClient', '/settings');
      const decoded = decodeState(state);

      expect(decoded.csrfToken).toBe('csrf456');
      expect(decoded.clientId).toBe('myClient');
      expect(decoded.returnTo).toBe('/settings');
    });

    it('includes timestamp in state', () => {
      const beforeTimestamp = Date.now();
      const state = generateAuthorizationState('csrf');
      const afterTimestamp = Date.now();
      const decoded = decodeState(state);

      expect(decoded.timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(decoded.timestamp).toBeLessThanOrEqual(afterTimestamp);
    });

    it('omits undefined optional parameters', () => {
      const state = generateAuthorizationState('csrf');
      const decoded = decodeState(state);

      expect(decoded).not.toHaveProperty('clientId');
      expect(decoded).not.toHaveProperty('returnTo');
    });

    it('generates URL-safe state string', () => {
      const state = generateAuthorizationState('csrf', 'client', '/path?query=value&foo=bar');

      // base64url should not contain these characters
      expect(state).not.toContain('+');
      expect(state).not.toContain('/');
      expect(state).not.toContain('=');
    });

    it('handles special characters in parameters', () => {
      const state = generateAuthorizationState(
        'csrf-with-special-chars!@#$',
        'client_id_123',
        '/path?redirect=https://example.com'
      );
      const decoded = decodeState(state);

      expect(decoded.csrfToken).toBe('csrf-with-special-chars!@#$');
      expect(decoded.returnTo).toBe('/path?redirect=https://example.com');
    });
  });

  describe('validateAuthorizationState', () => {
    it('returns decoded state for valid state string', () => {
      const state = generateAuthorizationState('csrf123', 'client456', '/dashboard');
      const result = validateAuthorizationState(state);

      expect(result.csrfToken).toBe('csrf123');
      expect(result.clientId).toBe('client456');
      expect(result.returnTo).toBe('/dashboard');
    });

    it('throws error for invalid state string', () => {
      expect(() => validateAuthorizationState('invalid-state')).toThrow('Invalid state parameter');
    });

    it('throws error for state without csrfToken', () => {
      // Manually encode state without csrfToken
      const invalidState = encode(JSON.stringify({ clientId: 'client' }));

      // The function catches inner errors and throws generic 'Invalid state parameter'
      expect(() => validateAuthorizationState(invalidState)).toThrow('Invalid state parameter');
    });

    it('throws error for empty state string', () => {
      expect(() => validateAuthorizationState('')).toThrow();
    });

    it('returns minimal result when only csrfToken is present', () => {
      const state = generateAuthorizationState('onlycsrf');
      const result = validateAuthorizationState(state);

      expect(result.csrfToken).toBe('onlycsrf');
      expect(result.clientId).toBeUndefined();
      expect(result.returnTo).toBeUndefined();
    });
  });

  describe('integration: state generation and validation', () => {
    it('roundtrip: generate and validate state', () => {
      const csrfToken = generateSecureToken(16);
      const clientId = 'test-client';
      const returnTo = '/protected/resource';

      const state = generateAuthorizationState(csrfToken, clientId, returnTo);
      const validated = validateAuthorizationState(state);

      expect(validated.csrfToken).toBe(csrfToken);
      expect(validated.clientId).toBe(clientId);
      expect(validated.returnTo).toBe(returnTo);
    });

    it('unique tokens generate unique states', () => {
      const states = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const csrfToken = generateSecureToken();
        const state = generateAuthorizationState(csrfToken);
        states.add(state);
      }

      expect(states.size).toBe(10);
    });
  });
});

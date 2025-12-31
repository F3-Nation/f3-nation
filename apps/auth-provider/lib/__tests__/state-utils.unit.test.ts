import { describe, it, expect } from 'vitest';
import { encodeState, decodeState } from '../state-utils';

describe('state-utils', () => {
  describe('encodeState', () => {
    it('encodes a simple object to base64url string', () => {
      const data = { foo: 'bar' };
      const encoded = encodeState(data);

      expect(typeof encoded).toBe('string');
      expect(encoded.length).toBeGreaterThan(0);
      // base64url should not contain +, /, or = characters
      expect(encoded).not.toMatch(/[+/=]/);
    });

    it('encodes an object with multiple properties', () => {
      const data = { csrfToken: 'abc123', clientId: 'client_456', returnTo: '/dashboard' };
      const encoded = encodeState(data);

      expect(typeof encoded).toBe('string');
      // Should be decodable back
      const decoded = decodeState(encoded);
      expect(decoded).toEqual(data);
    });

    it('encodes an object with nested properties', () => {
      const data = { user: { id: 1, name: 'test' }, meta: { timestamp: 12345 } };
      const encoded = encodeState(data);

      const decoded = decodeState(encoded);
      expect(decoded).toEqual(data);
    });

    it('encodes an empty object', () => {
      const data = {};
      const encoded = encodeState(data);

      expect(typeof encoded).toBe('string');
      const decoded = decodeState(encoded);
      expect(decoded).toEqual({});
    });

    it('encodes an object with various data types', () => {
      const data = {
        string: 'hello',
        number: 42,
        boolean: true,
        nullValue: null,
        array: [1, 2, 3],
      };
      const encoded = encodeState(data);

      const decoded = decodeState(encoded);
      expect(decoded).toEqual(data);
    });

    it('encodes an object with special characters in strings', () => {
      const data = { message: 'Hello, 世界! <script>alert("xss")</script>' };
      const encoded = encodeState(data);

      const decoded = decodeState(encoded);
      expect(decoded).toEqual(data);
    });

    it('encodes an object with URL as value', () => {
      const data = { returnTo: 'https://example.com/callback?foo=bar&baz=qux' };
      const encoded = encodeState(data);

      const decoded = decodeState(encoded);
      expect(decoded).toEqual(data);
    });
  });

  describe('decodeState', () => {
    it('decodes a valid base64url encoded state string', () => {
      const original = { csrfToken: 'token123' };
      const encoded = encodeState(original);
      const decoded = decodeState(encoded);

      expect(decoded).toEqual(original);
    });

    it('throws on invalid base64url string', () => {
      expect(() => decodeState('not-valid-base64!')).toThrow();
    });

    it('throws on valid base64url but invalid JSON', () => {
      // 'notjson' in base64url
      const invalidJson = 'bm90anNvbg';
      expect(() => decodeState(invalidJson)).toThrow();
    });

    it('throws on empty string', () => {
      expect(() => decodeState('')).toThrow();
    });

    it('roundtrip encode/decode preserves data integrity', () => {
      const testCases = [
        { simple: 'value' },
        { nested: { deep: { value: 123 } } },
        { array: [1, 'two', { three: 3 }] },
        { timestamp: Date.now(), uuid: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
      ];

      for (const data of testCases) {
        const encoded = encodeState(data);
        const decoded = decodeState(encoded);
        expect(decoded).toEqual(data);
      }
    });
  });

  describe('encodeState and decodeState integration', () => {
    it('handles typical OAuth state payload', () => {
      const oauthState = {
        csrfToken: 'csrf_abc123xyz',
        clientId: 'client_id_456',
        returnTo: '/dashboard',
        timestamp: 1704067200000,
      };

      const encoded = encodeState(oauthState);
      const decoded = decodeState(encoded);

      expect(decoded).toEqual(oauthState);
      expect(decoded.csrfToken).toBe('csrf_abc123xyz');
    });

    it('produces URL-safe output', () => {
      // Create data that would produce +, /, = in standard base64
      const data = { binary: '>>>???<<<', special: '++//' };
      const encoded = encodeState(data);

      // base64url should not contain these characters
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    });
  });
});

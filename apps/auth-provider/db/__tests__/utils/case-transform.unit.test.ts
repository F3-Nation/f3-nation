import { describe, it, expect } from 'vitest';
import {
  toSnakeCase,
  toCamelCase,
  keysToCamelCase,
  keysToSnakeCase,
  rowToEntity,
  entityToRow,
  rowsToEntities,
} from '../../utils/case-transform';

describe('case-transform', () => {
  describe('toSnakeCase', () => {
    it('converts simple camelCase to snake_case', () => {
      expect(toSnakeCase('camelCase')).toBe('camel_case');
    });

    it('converts multiple camelCase words', () => {
      expect(toSnakeCase('thisIsATest')).toBe('this_is_a_test');
    });

    it('handles single word (no change needed)', () => {
      expect(toSnakeCase('word')).toBe('word');
    });

    it('handles already lowercase string', () => {
      expect(toSnakeCase('lowercase')).toBe('lowercase');
    });

    it('handles empty string', () => {
      expect(toSnakeCase('')).toBe('');
    });

    it('converts string starting with uppercase', () => {
      expect(toSnakeCase('CamelCase')).toBe('_camel_case');
    });

    it('handles consecutive uppercase letters', () => {
      expect(toSnakeCase('parseHTMLContent')).toBe('parse_h_t_m_l_content');
    });

    it('handles string with numbers', () => {
      expect(toSnakeCase('user123Name')).toBe('user123_name');
    });

    it('converts common database field names', () => {
      expect(toSnakeCase('createdAt')).toBe('created_at');
      expect(toSnakeCase('updatedAt')).toBe('updated_at');
      expect(toSnakeCase('userId')).toBe('user_id');
      expect(toSnakeCase('clientId')).toBe('client_id');
      expect(toSnakeCase('accessToken')).toBe('access_token');
      expect(toSnakeCase('refreshToken')).toBe('refresh_token');
    });

    it('handles mixed case patterns', () => {
      expect(toSnakeCase('isActive')).toBe('is_active');
      expect(toSnakeCase('emailVerified')).toBe('email_verified');
    });
  });

  describe('toCamelCase', () => {
    it('converts simple snake_case to camelCase', () => {
      expect(toCamelCase('snake_case')).toBe('snakeCase');
    });

    it('converts multiple snake_case words', () => {
      expect(toCamelCase('this_is_a_test')).toBe('thisIsATest');
    });

    it('handles single word (no change needed)', () => {
      expect(toCamelCase('word')).toBe('word');
    });

    it('handles empty string', () => {
      expect(toCamelCase('')).toBe('');
    });

    it('handles string with no underscores', () => {
      expect(toCamelCase('nounderscore')).toBe('nounderscore');
    });

    it('handles consecutive underscores', () => {
      expect(toCamelCase('double__underscore')).toBe('double_Underscore');
    });

    it('handles string starting with underscore', () => {
      // Leading underscore followed by letter gets converted (underscore removed, letter capitalized)
      expect(toCamelCase('_leading_underscore')).toBe('LeadingUnderscore');
    });

    it('handles string ending with underscore', () => {
      expect(toCamelCase('trailing_underscore_')).toBe('trailingUnderscore_');
    });

    it('converts common database column names', () => {
      expect(toCamelCase('created_at')).toBe('createdAt');
      expect(toCamelCase('updated_at')).toBe('updatedAt');
      expect(toCamelCase('user_id')).toBe('userId');
      expect(toCamelCase('client_id')).toBe('clientId');
      expect(toCamelCase('access_token')).toBe('accessToken');
      expect(toCamelCase('refresh_token')).toBe('refreshToken');
    });

    it('handles common boolean column names', () => {
      expect(toCamelCase('is_active')).toBe('isActive');
      expect(toCamelCase('email_verified')).toBe('emailVerified');
    });

    it('handles numbers in column names', () => {
      expect(toCamelCase('oauth2_token')).toBe('oauth2Token');
      expect(toCamelCase('user_123')).toBe('user_123');
    });
  });

  describe('keysToCamelCase', () => {
    it('converts all keys to camelCase', () => {
      const input = {
        user_id: 1,
        first_name: 'John',
        last_name: 'Doe',
      };

      const result = keysToCamelCase(input);

      expect(result).toEqual({
        userId: 1,
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('preserves values unchanged', () => {
      const input = {
        created_at: new Date('2024-01-01'),
        is_active: true,
        count: 42,
      };

      const result = keysToCamelCase(input);

      expect(result.createdAt).toEqual(new Date('2024-01-01'));
      expect(result.isActive).toBe(true);
      expect(result.count).toBe(42);
    });

    it('handles empty object', () => {
      const result = keysToCamelCase({});
      expect(result).toEqual({});
    });

    it('handles object with single key', () => {
      const result = keysToCamelCase({ user_id: 1 });
      expect(result).toEqual({ userId: 1 });
    });

    it('handles null and undefined values', () => {
      const input = {
        null_value: null,
        undefined_value: undefined,
      };

      const result = keysToCamelCase(input);

      expect(result.nullValue).toBeNull();
      expect(result.undefinedValue).toBeUndefined();
    });
  });

  describe('keysToSnakeCase', () => {
    it('converts all keys to snake_case', () => {
      const input = {
        userId: 1,
        firstName: 'John',
        lastName: 'Doe',
      };

      const result = keysToSnakeCase(input);

      expect(result).toEqual({
        user_id: 1,
        first_name: 'John',
        last_name: 'Doe',
      });
    });

    it('preserves values unchanged', () => {
      const input = {
        createdAt: new Date('2024-01-01'),
        isActive: true,
        count: 42,
      };

      const result = keysToSnakeCase(input);

      expect(result.created_at).toEqual(new Date('2024-01-01'));
      expect(result.is_active).toBe(true);
      expect(result.count).toBe(42);
    });

    it('handles empty object', () => {
      const result = keysToSnakeCase({});
      expect(result).toEqual({});
    });

    it('handles object with single key', () => {
      const result = keysToSnakeCase({ userId: 1 });
      expect(result).toEqual({ user_id: 1 });
    });
  });

  describe('rowToEntity', () => {
    it('transforms database row to TypeScript entity', () => {
      const row = {
        id: 1,
        user_id: 123,
        client_id: 'abc',
        created_at: new Date('2024-01-01'),
        is_active: true,
      };

      const entity = rowToEntity<
        typeof row,
        {
          id: number;
          userId: number;
          clientId: string;
          createdAt: Date;
          isActive: boolean;
        }
      >(row);

      expect(entity.id).toBe(1);
      expect(entity.userId).toBe(123);
      expect(entity.clientId).toBe('abc');
      expect(entity.createdAt).toEqual(new Date('2024-01-01'));
      expect(entity.isActive).toBe(true);
    });

    it('handles typical user row', () => {
      const userRow = {
        id: 1,
        email: 'test@example.com',
        f3_name: 'TestUser',
        email_verified: new Date(),
        avatar_url: 'https://example.com/avatar.jpg',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const user = rowToEntity<
        typeof userRow,
        {
          id: number;
          email: string;
          f3Name: string;
          emailVerified: Date;
          avatarUrl: string;
          createdAt: Date;
          updatedAt: Date;
        }
      >(userRow);

      expect(user.email).toBe('test@example.com');
      expect(user.f3Name).toBe('TestUser');
      expect(user.avatarUrl).toBe('https://example.com/avatar.jpg');
    });

    it('handles OAuth client row', () => {
      const clientRow = {
        id: 'client123',
        name: 'My App',
        client_secret: 'secret',
        redirect_uris: '["http://localhost:3000/callback"]',
        scopes: 'openid profile email',
        allowed_origin: 'http://localhost:3000',
        is_active: true,
        created_at: new Date(),
      };

      const client = rowToEntity<
        typeof clientRow,
        {
          id: string;
          name: string;
          clientSecret: string;
          redirectUris: string;
          scopes: string;
          allowedOrigin: string;
          isActive: boolean;
          createdAt: Date;
        }
      >(clientRow);

      expect(client.clientSecret).toBe('secret');
      expect(client.redirectUris).toBe('["http://localhost:3000/callback"]');
      expect(client.allowedOrigin).toBe('http://localhost:3000');
      expect(client.isActive).toBe(true);
    });

    it('handles empty row', () => {
      const result = rowToEntity({});
      expect(result).toEqual({});
    });
  });

  describe('entityToRow', () => {
    it('transforms TypeScript entity to database row', () => {
      const entity = {
        id: 1,
        userId: 123,
        clientId: 'abc',
        createdAt: new Date('2024-01-01'),
        isActive: true,
      };

      const row = entityToRow<
        typeof entity,
        {
          id: number;
          user_id: number;
          client_id: string;
          created_at: Date;
          is_active: boolean;
        }
      >(entity);

      expect(row.id).toBe(1);
      expect(row.user_id).toBe(123);
      expect(row.client_id).toBe('abc');
      expect(row.created_at).toEqual(new Date('2024-01-01'));
      expect(row.is_active).toBe(true);
    });

    it('handles empty entity', () => {
      const result = entityToRow({});
      expect(result).toEqual({});
    });
  });

  describe('rowsToEntities', () => {
    it('transforms array of rows to entities', () => {
      const rows = [
        { id: 1, user_name: 'Alice' },
        { id: 2, user_name: 'Bob' },
        { id: 3, user_name: 'Charlie' },
      ];

      const entities = rowsToEntities<(typeof rows)[0], { id: number; userName: string }>(rows);

      expect(entities).toHaveLength(3);
      expect(entities[0].userName).toBe('Alice');
      expect(entities[1].userName).toBe('Bob');
      expect(entities[2].userName).toBe('Charlie');
    });

    it('handles empty array', () => {
      const result = rowsToEntities([]);
      expect(result).toEqual([]);
    });

    it('handles array with single row', () => {
      const rows = [{ created_at: new Date('2024-01-01') }];
      const entities = rowsToEntities<(typeof rows)[0], { createdAt: Date }>(rows);

      expect(entities).toHaveLength(1);
      expect(entities[0].createdAt).toEqual(new Date('2024-01-01'));
    });
  });

  describe('roundtrip transformations', () => {
    it('entity -> row -> entity preserves data', () => {
      const original = {
        userId: 123,
        clientId: 'abc',
        accessToken: 'token123',
        createdAt: new Date('2024-01-01'),
        isActive: true,
      };

      const row = entityToRow(original) as Record<string, unknown>;
      const restored = rowToEntity(row);

      expect(restored).toEqual(original);
    });

    it('row -> entity -> row preserves data', () => {
      const original = {
        user_id: 123,
        client_id: 'abc',
        access_token: 'token123',
        created_at: new Date('2024-01-01'),
        is_active: true,
      };

      const entity = rowToEntity(original) as Record<string, unknown>;
      const restored = entityToRow(entity);

      expect(restored).toEqual(original);
    });

    it('camelCase -> snakeCase -> camelCase preserves string', () => {
      const testCases = ['userId', 'createdAt', 'accessToken', 'emailVerified', 'clientId'];

      for (const original of testCases) {
        const snake = toSnakeCase(original);
        const restored = toCamelCase(snake);
        expect(restored).toBe(original);
      }
    });

    it('snakeCase -> camelCase -> snakeCase preserves string', () => {
      const testCases = ['user_id', 'created_at', 'access_token', 'email_verified', 'client_id'];

      for (const original of testCases) {
        const camel = toCamelCase(original);
        const restored = toSnakeCase(camel);
        expect(restored).toBe(original);
      }
    });
  });
});

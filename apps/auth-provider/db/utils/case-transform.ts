/**
 * Convert a string from camelCase to snake_case
 */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Convert a string from snake_case to camelCase
 */
export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert object keys from snake_case to camelCase
 */
export function keysToCamelCase<T extends Record<string, unknown>>(
  obj: Record<string, unknown>
): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toCamelCase(key)] = value;
  }
  return result as T;
}

/**
 * Convert object keys from camelCase to snake_case
 */
export function keysToSnakeCase<T extends Record<string, unknown>>(
  obj: Record<string, unknown>
): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[toSnakeCase(key)] = value;
  }
  return result as T;
}

/**
 * Transform a database row (snake_case) to a TypeScript entity (camelCase)
 */
export function rowToEntity<TRow extends Record<string, unknown>, TEntity>(row: TRow): TEntity {
  return keysToCamelCase<TEntity & Record<string, unknown>>(row);
}

/**
 * Transform a TypeScript entity (camelCase) to a database row (snake_case)
 */
export function entityToRow<TEntity extends Record<string, unknown>, TRow>(entity: TEntity): TRow {
  return keysToSnakeCase<TRow & Record<string, unknown>>(entity);
}

/**
 * Transform an array of database rows to TypeScript entities
 */
export function rowsToEntities<TRow extends Record<string, unknown>, TEntity>(
  rows: TRow[]
): TEntity[] {
  return rows.map(row => rowToEntity<TRow, TEntity>(row));
}

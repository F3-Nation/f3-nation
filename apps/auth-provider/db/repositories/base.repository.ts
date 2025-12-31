import { DatabaseClient } from '../client';
import { rowToEntity, rowsToEntities, toSnakeCase } from '../utils/case-transform';

/**
 * Base repository class with common operations
 */
export abstract class BaseRepository<
  TRow extends Record<string, unknown>,
  TEntity,
  TInsert extends Record<string, unknown>,
  TUpdate extends Record<string, unknown>,
> {
  constructor(
    protected client: DatabaseClient,
    protected tableName: string,
    protected schema: string = 'auth'
  ) {}

  /**
   * Get the fully qualified table name
   */
  protected get qualifiedTableName(): string {
    return `${this.schema}.${this.tableName}`;
  }

  /**
   * Transform a database row to an entity
   */
  protected mapRow(row: TRow): TEntity {
    return rowToEntity<TRow, TEntity>(row);
  }

  /**
   * Transform multiple database rows to entities
   */
  protected mapRows(rows: TRow[]): TEntity[] {
    return rowsToEntities<TRow, TEntity>(rows);
  }

  /**
   * Build an INSERT query from an entity object
   * Returns { sql, params } where params are in the correct order
   */
  protected buildInsertQuery(data: TInsert): { sql: string; params: unknown[] } {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    const columns = entries.map(([key]) => toSnakeCase(key));
    const placeholders = entries.map((_, i) => `$${i + 1}`);
    const params = entries.map(([, value]) => value);

    const sql = `INSERT INTO ${this.qualifiedTableName} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    return { sql, params };
  }

  /**
   * Build an UPDATE query from an entity object
   * Returns { sql, params, paramIndex } for chaining with WHERE clause
   */
  protected buildUpdateQuery(
    data: TUpdate,
    startParamIndex: number = 1
  ): { setClauses: string[]; params: unknown[]; nextParamIndex: number } {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = startParamIndex;

    for (const [key, value] of entries) {
      setClauses.push(`${toSnakeCase(key)} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }

    return { setClauses, params, nextParamIndex: paramIndex };
  }

  /**
   * Execute a query and return the first row as an entity, or null
   */
  protected async queryOne(sql: string, params: unknown[] = []): Promise<TEntity | null> {
    const row = await this.client.queryOne<TRow>(sql, params);
    return row ? this.mapRow(row) : null;
  }

  /**
   * Execute a query and return all rows as entities
   */
  protected async queryMany(sql: string, params: unknown[] = []): Promise<TEntity[]> {
    const rows = await this.client.queryMany<TRow>(sql, params);
    return this.mapRows(rows);
  }
}

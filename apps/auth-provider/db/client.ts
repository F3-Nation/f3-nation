import { Pool, PoolClient, QueryResult } from 'pg';

export class DatabaseClient {
  constructor(private pool: Pool) {}

  /**
   * Execute a parameterized query with type safety
   */
  async query<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, params);
  }

  /**
   * Execute a query and return the first row, or null if no rows
   */
  async queryOne<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | null> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows[0] ?? null;
  }

  /**
   * Execute a query and return all rows
   */
  async queryMany<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  /**
   * Execute operations within a transaction
   */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get a client from the pool for manual transaction management
   */
  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /**
   * Get the underlying pool (for compatibility during migration)
   */
  getPool(): Pool {
    return this.pool;
  }
}

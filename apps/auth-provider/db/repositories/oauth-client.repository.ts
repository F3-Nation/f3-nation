import { BaseRepository } from './base.repository';
import { OAuthClient, OAuthClientRow, OAuthClientInsert, OAuthClientUpdate } from '../types';
import { DatabaseClient } from '../client';

export class OAuthClientRepository extends BaseRepository<
  OAuthClientRow,
  OAuthClient,
  OAuthClientInsert,
  OAuthClientUpdate
> {
  constructor(client: DatabaseClient) {
    super(client, 'oauth_clients', 'auth');
  }

  async findById(id: string): Promise<OAuthClient | null> {
    return this.queryOne(`SELECT * FROM ${this.qualifiedTableName} WHERE id = $1`, [id]);
  }

  async findActiveById(id: string): Promise<OAuthClient | null> {
    return this.queryOne(
      `SELECT * FROM ${this.qualifiedTableName} WHERE id = $1 AND is_active = true`,
      [id]
    );
  }

  async findAll(): Promise<OAuthClient[]> {
    return this.queryMany(`SELECT * FROM ${this.qualifiedTableName} ORDER BY created_at DESC`, []);
  }

  async findAllActive(): Promise<OAuthClient[]> {
    return this.queryMany(
      `SELECT * FROM ${this.qualifiedTableName} WHERE is_active = true ORDER BY created_at DESC`,
      []
    );
  }

  async create(data: OAuthClientInsert): Promise<OAuthClient> {
    const { sql, params } = this.buildInsertQuery(data);
    const result = await this.queryOne(sql, params);
    if (!result) {
      throw new Error('Failed to create OAuth client');
    }
    return result;
  }

  async update(id: string, data: OAuthClientUpdate): Promise<OAuthClient | null> {
    const { setClauses, params, nextParamIndex } = this.buildUpdateQuery(data);
    if (setClauses.length === 0) return this.findById(id);

    const sql = `UPDATE ${this.qualifiedTableName} SET ${setClauses.join(', ')} WHERE id = $${nextParamIndex} RETURNING *`;
    params.push(id);

    return this.queryOne(sql, params);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.client.query(`DELETE FROM ${this.qualifiedTableName} WHERE id = $1`, [
      id,
    ]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async deactivate(id: string): Promise<OAuthClient | null> {
    return this.update(id, { isActive: false });
  }
}

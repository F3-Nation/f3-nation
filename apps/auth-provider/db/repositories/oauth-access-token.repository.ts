import { BaseRepository } from './base.repository';
import { OAuthAccessToken, OAuthAccessTokenRow, OAuthAccessTokenInsert } from '../types';
import { DatabaseClient } from '../client';

export class OAuthAccessTokenRepository extends BaseRepository<
  OAuthAccessTokenRow,
  OAuthAccessToken,
  OAuthAccessTokenInsert,
  Record<string, never>
> {
  constructor(client: DatabaseClient) {
    super(client, 'oauth_access_tokens', 'auth');
  }

  async findByToken(token: string): Promise<OAuthAccessToken | null> {
    return this.queryOne(`SELECT * FROM ${this.qualifiedTableName} WHERE token = $1`, [token]);
  }

  async findValid(token: string): Promise<OAuthAccessToken | null> {
    return this.queryOne(
      `SELECT * FROM ${this.qualifiedTableName} WHERE token = $1 AND expires > NOW()`,
      [token]
    );
  }

  async findByUserId(userId: number): Promise<OAuthAccessToken[]> {
    return this.queryMany(`SELECT * FROM ${this.qualifiedTableName} WHERE user_id = $1`, [userId]);
  }

  async create(data: OAuthAccessTokenInsert): Promise<OAuthAccessToken> {
    const { sql, params } = this.buildInsertQuery(data);
    const result = await this.queryOne(sql, params);
    if (!result) {
      throw new Error('Failed to create access token');
    }
    return result;
  }

  async delete(token: string): Promise<boolean> {
    const result = await this.client.query(
      `DELETE FROM ${this.qualifiedTableName} WHERE token = $1`,
      [token]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }

  async deleteByClientId(clientId: string): Promise<number> {
    const result = await this.client.query(
      `DELETE FROM ${this.qualifiedTableName} WHERE client_id = $1`,
      [clientId]
    );
    return result.rowCount ?? 0;
  }

  async deleteByUserId(userId: number): Promise<number> {
    const result = await this.client.query(
      `DELETE FROM ${this.qualifiedTableName} WHERE user_id = $1`,
      [userId]
    );
    return result.rowCount ?? 0;
  }

  async deleteExpired(): Promise<number> {
    const result = await this.client.query(
      `DELETE FROM ${this.qualifiedTableName} WHERE expires < NOW()`,
      []
    );
    return result.rowCount ?? 0;
  }
}

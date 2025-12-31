import { BaseRepository } from './base.repository';
import { OAuthRefreshToken, OAuthRefreshTokenRow, OAuthRefreshTokenInsert } from '../types';
import { DatabaseClient } from '../client';

export class OAuthRefreshTokenRepository extends BaseRepository<
  OAuthRefreshTokenRow,
  OAuthRefreshToken,
  OAuthRefreshTokenInsert,
  Record<string, never>
> {
  constructor(client: DatabaseClient) {
    super(client, 'oauth_refresh_tokens', 'auth');
  }

  async findByToken(token: string): Promise<OAuthRefreshToken | null> {
    return this.queryOne(`SELECT * FROM ${this.qualifiedTableName} WHERE token = $1`, [token]);
  }

  async findValid(token: string, clientId: string): Promise<OAuthRefreshToken | null> {
    return this.queryOne(
      `SELECT * FROM ${this.qualifiedTableName} WHERE token = $1 AND client_id = $2 AND expires > NOW()`,
      [token, clientId]
    );
  }

  async findByAccessToken(accessToken: string): Promise<OAuthRefreshToken | null> {
    return this.queryOne(`SELECT * FROM ${this.qualifiedTableName} WHERE access_token = $1`, [
      accessToken,
    ]);
  }

  async findByUserId(userId: number): Promise<OAuthRefreshToken[]> {
    return this.queryMany(`SELECT * FROM ${this.qualifiedTableName} WHERE user_id = $1`, [userId]);
  }

  async create(data: OAuthRefreshTokenInsert): Promise<OAuthRefreshToken> {
    const { sql, params } = this.buildInsertQuery(data);
    const result = await this.queryOne(sql, params);
    if (!result) {
      throw new Error('Failed to create refresh token');
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

  async deleteByAccessToken(accessToken: string): Promise<boolean> {
    const result = await this.client.query(
      `DELETE FROM ${this.qualifiedTableName} WHERE access_token = $1`,
      [accessToken]
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

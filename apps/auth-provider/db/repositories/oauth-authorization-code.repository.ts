import { BaseRepository } from './base.repository';
import {
  OAuthAuthorizationCode,
  OAuthAuthorizationCodeRow,
  OAuthAuthorizationCodeInsert,
} from '../types';
import { DatabaseClient } from '../client';

export class OAuthAuthorizationCodeRepository extends BaseRepository<
  OAuthAuthorizationCodeRow,
  OAuthAuthorizationCode,
  OAuthAuthorizationCodeInsert,
  Record<string, never>
> {
  constructor(client: DatabaseClient) {
    super(client, 'oauth_authorization_codes', 'auth');
  }

  async findByCode(code: string): Promise<OAuthAuthorizationCode | null> {
    return this.queryOne(`SELECT * FROM ${this.qualifiedTableName} WHERE code = $1`, [code]);
  }

  async findValid(
    code: string,
    clientId: string,
    redirectUri: string
  ): Promise<OAuthAuthorizationCode | null> {
    return this.queryOne(
      `SELECT * FROM ${this.qualifiedTableName}
       WHERE code = $1 AND client_id = $2 AND redirect_uri = $3 AND expires > NOW()`,
      [code, clientId, redirectUri]
    );
  }

  async create(data: OAuthAuthorizationCodeInsert): Promise<OAuthAuthorizationCode> {
    const { sql, params } = this.buildInsertQuery(data);
    const result = await this.queryOne(sql, params);
    if (!result) {
      throw new Error('Failed to create authorization code');
    }
    return result;
  }

  async delete(code: string): Promise<boolean> {
    const result = await this.client.query(
      `DELETE FROM ${this.qualifiedTableName} WHERE code = $1`,
      [code]
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

import { BaseRepository } from './base.repository';
import { VerificationToken, VerificationTokenRow, VerificationTokenInsert } from '../types';
import { DatabaseClient } from '../client';

export class VerificationTokenRepository extends BaseRepository<
  VerificationTokenRow,
  VerificationToken,
  VerificationTokenInsert,
  Record<string, never>
> {
  constructor(client: DatabaseClient) {
    super(client, 'verification_tokens', 'auth');
  }

  async find(identifier: string, token: string): Promise<VerificationToken | null> {
    return this.queryOne(
      `SELECT * FROM ${this.qualifiedTableName} WHERE identifier = $1 AND token = $2`,
      [identifier, token]
    );
  }

  async findByIdentifier(identifier: string): Promise<VerificationToken[]> {
    return this.queryMany(`SELECT * FROM ${this.qualifiedTableName} WHERE identifier = $1`, [
      identifier,
    ]);
  }

  async create(data: VerificationTokenInsert): Promise<VerificationToken> {
    const { sql, params } = this.buildInsertQuery(data);
    const result = await this.queryOne(sql, params);
    if (!result) {
      throw new Error('Failed to create verification token');
    }
    return result;
  }

  async delete(identifier: string, token: string): Promise<VerificationToken | null> {
    // Return the deleted token (for NextAuth compatibility)
    const sql = `DELETE FROM ${this.qualifiedTableName} WHERE identifier = $1 AND token = $2 RETURNING *`;
    return this.queryOne(sql, [identifier, token]);
  }

  async deleteByIdentifier(identifier: string): Promise<number> {
    const result = await this.client.query(
      `DELETE FROM ${this.qualifiedTableName} WHERE identifier = $1`,
      [identifier]
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

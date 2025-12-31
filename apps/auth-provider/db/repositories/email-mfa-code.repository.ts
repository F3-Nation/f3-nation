import { BaseRepository } from './base.repository';
import { EmailMfaCode, EmailMfaCodeRow, EmailMfaCodeInsert, EmailMfaCodeUpdate } from '../types';
import { DatabaseClient } from '../client';

export class EmailMfaCodeRepository extends BaseRepository<
  EmailMfaCodeRow,
  EmailMfaCode,
  EmailMfaCodeInsert,
  EmailMfaCodeUpdate
> {
  constructor(client: DatabaseClient) {
    super(client, 'email_mfa_codes', 'auth');
  }

  async findById(id: string): Promise<EmailMfaCode | null> {
    return this.queryOne(`SELECT * FROM ${this.qualifiedTableName} WHERE id = $1`, [id]);
  }

  async findByEmail(email: string): Promise<EmailMfaCode[]> {
    return this.queryMany(
      `SELECT * FROM ${this.qualifiedTableName} WHERE email = $1 ORDER BY created_at DESC`,
      [email]
    );
  }

  async findLatestUnconsumed(email: string): Promise<EmailMfaCode | null> {
    return this.queryOne(
      `SELECT * FROM ${this.qualifiedTableName}
       WHERE email = $1 AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
  }

  async create(data: EmailMfaCodeInsert): Promise<EmailMfaCode> {
    const { sql, params } = this.buildInsertQuery(data);
    const result = await this.queryOne(sql, params);
    if (!result) {
      throw new Error('Failed to create email MFA code');
    }
    return result;
  }

  async update(id: string, data: EmailMfaCodeUpdate): Promise<EmailMfaCode | null> {
    const { setClauses, params, nextParamIndex } = this.buildUpdateQuery(data);
    if (setClauses.length === 0) return this.findById(id);

    const sql = `UPDATE ${this.qualifiedTableName} SET ${setClauses.join(', ')} WHERE id = $${nextParamIndex} RETURNING *`;
    params.push(id);

    return this.queryOne(sql, params);
  }

  async markConsumed(id: string): Promise<EmailMfaCode | null> {
    return this.update(id, { consumedAt: new Date() });
  }

  async incrementAttemptCount(id: string): Promise<EmailMfaCode | null> {
    const sql = `UPDATE ${this.qualifiedTableName} SET attempt_count = attempt_count + 1 WHERE id = $1 RETURNING *`;
    return this.queryOne(sql, [id]);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.client.query(`DELETE FROM ${this.qualifiedTableName} WHERE id = $1`, [
      id,
    ]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async deleteByEmail(email: string): Promise<number> {
    const result = await this.client.query(
      `DELETE FROM ${this.qualifiedTableName} WHERE email = $1`,
      [email]
    );
    return result.rowCount ?? 0;
  }

  async deleteUnconsumedByEmail(email: string): Promise<number> {
    const result = await this.client.query(
      `DELETE FROM ${this.qualifiedTableName} WHERE email = $1 AND consumed_at IS NULL`,
      [email]
    );
    return result.rowCount ?? 0;
  }

  async deleteExpired(): Promise<number> {
    const result = await this.client.query(
      `DELETE FROM ${this.qualifiedTableName} WHERE expires_at < NOW()`,
      []
    );
    return result.rowCount ?? 0;
  }
}

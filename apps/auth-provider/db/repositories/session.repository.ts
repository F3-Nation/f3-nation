import { BaseRepository } from './base.repository';
import { Session, SessionRow, SessionInsert, SessionUpdate } from '../types';
import { DatabaseClient } from '../client';

export class SessionRepository extends BaseRepository<
  SessionRow,
  Session,
  SessionInsert,
  SessionUpdate
> {
  constructor(client: DatabaseClient) {
    super(client, 'sessions', 'auth');
  }

  async findByToken(sessionToken: string): Promise<Session | null> {
    return this.queryOne(`SELECT * FROM ${this.qualifiedTableName} WHERE session_token = $1`, [
      sessionToken,
    ]);
  }

  async findByUserId(userId: number): Promise<Session[]> {
    return this.queryMany(`SELECT * FROM ${this.qualifiedTableName} WHERE user_id = $1`, [userId]);
  }

  async create(data: SessionInsert): Promise<Session> {
    const { sql, params } = this.buildInsertQuery(data);
    const result = await this.queryOne(sql, params);
    if (!result) {
      throw new Error('Failed to create session');
    }
    return result;
  }

  async update(sessionToken: string, data: SessionUpdate): Promise<Session | null> {
    const { setClauses, params, nextParamIndex } = this.buildUpdateQuery(data);
    if (setClauses.length === 0) return this.findByToken(sessionToken);

    const sql = `UPDATE ${this.qualifiedTableName} SET ${setClauses.join(', ')} WHERE session_token = $${nextParamIndex} RETURNING *`;
    params.push(sessionToken);

    return this.queryOne(sql, params);
  }

  async delete(sessionToken: string): Promise<boolean> {
    const result = await this.client.query(
      `DELETE FROM ${this.qualifiedTableName} WHERE session_token = $1`,
      [sessionToken]
    );
    return result.rowCount !== null && result.rowCount > 0;
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

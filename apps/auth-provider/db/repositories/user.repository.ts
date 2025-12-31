import { BaseRepository } from './base.repository';
import { User, UserRow, UserInsert, UserUpdate } from '../types';
import { DatabaseClient } from '../client';

export class UserRepository extends BaseRepository<UserRow, User, UserInsert, UserUpdate> {
  constructor(client: DatabaseClient) {
    super(client, 'users', 'public');
  }

  async findById(id: number): Promise<User | null> {
    return this.queryOne(`SELECT * FROM ${this.qualifiedTableName} WHERE id = $1`, [id]);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.queryOne(`SELECT * FROM ${this.qualifiedTableName} WHERE email = $1`, [email]);
  }

  async create(data: UserInsert): Promise<User> {
    const { sql, params } = this.buildInsertQuery(data);
    const result = await this.queryOne(sql, params);
    if (!result) {
      throw new Error('Failed to create user');
    }
    return result;
  }

  async update(id: number, data: UserUpdate): Promise<User | null> {
    const { setClauses, params, nextParamIndex } = this.buildUpdateQuery(data);
    if (setClauses.length === 0) return this.findById(id);

    const sql = `UPDATE ${this.qualifiedTableName} SET ${setClauses.join(', ')} WHERE id = $${nextParamIndex} RETURNING *`;
    params.push(id);

    return this.queryOne(sql, params);
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.client.query(`DELETE FROM ${this.qualifiedTableName} WHERE id = $1`, [
      id,
    ]);
    return result.rowCount !== null && result.rowCount > 0;
  }
}

import { BaseRepository } from './base.repository';
import { UserProfile, UserProfileRow, UserProfileInsert, UserProfileUpdate } from '../types';
import { DatabaseClient } from '../client';

export class UserProfileRepository extends BaseRepository<
  UserProfileRow,
  UserProfile,
  UserProfileInsert,
  UserProfileUpdate
> {
  constructor(client: DatabaseClient) {
    super(client, 'user_profiles', 'auth');
  }

  async findByUserId(userId: number): Promise<UserProfile | null> {
    return this.queryOne(`SELECT * FROM ${this.qualifiedTableName} WHERE user_id = $1`, [userId]);
  }

  async create(data: UserProfileInsert): Promise<UserProfile> {
    const { sql, params } = this.buildInsertQuery(data);
    const result = await this.queryOne(sql, params);
    if (!result) {
      throw new Error('Failed to create user profile');
    }
    return result;
  }

  async update(userId: number, data: UserProfileUpdate): Promise<UserProfile | null> {
    const { setClauses, params, nextParamIndex } = this.buildUpdateQuery(data);
    if (setClauses.length === 0) return this.findByUserId(userId);

    const sql = `UPDATE ${this.qualifiedTableName} SET ${setClauses.join(', ')} WHERE user_id = $${nextParamIndex} RETURNING *`;
    params.push(userId);

    return this.queryOne(sql, params);
  }

  async upsert(data: UserProfileInsert & UserProfileUpdate): Promise<UserProfile> {
    const { userId, ...updateData } = data;

    // Check if profile exists
    const existing = await this.findByUserId(userId);

    if (existing) {
      // Update existing profile
      const result = await this.update(userId, updateData);
      if (!result) {
        throw new Error('Failed to update user profile');
      }
      return result;
    } else {
      // Create new profile
      return this.create(data);
    }
  }

  async delete(userId: number): Promise<boolean> {
    const result = await this.client.query(
      `DELETE FROM ${this.qualifiedTableName} WHERE user_id = $1`,
      [userId]
    );
    return result.rowCount !== null && result.rowCount > 0;
  }
}

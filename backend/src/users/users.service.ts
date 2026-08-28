import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /**
   * Phase 1 is single-user and local. Every table still carries userId so going
   * multi-user later is a config change, not a migration.
   */
  async ensureDefaultUser(): Promise<User> {
    const existing = await this.users.find({
      order: { createdAt: 'ASC' },
      take: 1,
    });
    if (existing.length > 0) return existing[0];
    return this.users.save(this.users.create({ displayName: 'me' }));
  }

  async getSettings() {
    const user = await this.ensureDefaultUser();
    return { defaultFee: user.defaultFee };
  }

  async updateSettings(defaultFee: number) {
    const user = await this.ensureDefaultUser();
    user.defaultFee = Math.abs(defaultFee);
    await this.users.save(user);
    return { defaultFee: user.defaultFee };
  }
}

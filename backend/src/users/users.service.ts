import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity.js';
import { currentUserId } from './user-context.js';

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

  /**
   * The user this request belongs to.
   *
   * The seam for multi-user. Every service that used to call
   * `ensureDefaultUser()` calls this instead, so becoming multi-user is a
   * change to how this ONE method resolves a user rather than a change to
   * eleven services. Until an authenticated identity is available it returns
   * the single owner, which is exactly today's behaviour.
   */
  async currentUser(): Promise<User> {
    const id = currentUserId();
    if (id) {
      const found = await this.users.findOne({ where: { id } });
      if (found) return found;
      // A signed token for a user who no longer exists. Falling back to the
      // owner here would hand his holdings and watchlist to whoever holds that token.
      throw new UnauthorizedException('Account no longer exists');
    }
    /**
     * No identity on the request: fall back to the single owner. This is
     * what keeps the pre-multi-user password login working — its legacy
     * tokens carry `sub: 'owner'`, which the middleware maps to no id.
     */
    return this.ensureDefaultUser();
  }
}

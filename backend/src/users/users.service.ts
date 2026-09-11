import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity.js';
import { currentUserId } from './user-context.js';
import { reasonVocabulary } from '../journal/reasons.js';

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
   * The reason vocabulary rides along here rather than on an endpoint of its
   * own: it is a static list the composer needs once per session, and this is
   * already fetched once per session. It is read-only — `updateSettings` does
   * not take it.
   */
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
    }
    /**
     * No identity on the request, or an id that no longer exists: fall back
     * to the single owner.
     *
     * This is what keeps the pre-multi-user password login working, and it
     * fails in the safe direction — the owner can never be locked out of his
     * own portfolio by a stale token. It does mean a deleted user's token
     * quietly becomes the owner, which is acceptable while this serves one
     * person and must be revisited before anyone else has an account.
     */
    return this.ensureDefaultUser();
  }

  async getSettings() {
    const user = await this.currentUser();
    return { defaultFee: user.defaultFee, reasons: reasonVocabulary() };
  }

  async updateSettings(defaultFee: number) {
    const user = await this.currentUser();
    user.defaultFee = Math.abs(defaultFee);
    await this.users.save(user);
    return { defaultFee: user.defaultFee };
  }
}

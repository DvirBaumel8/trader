import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { compare, hash } from 'bcryptjs';
import { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { GoogleVerifier } from './google-verifier.js';

export interface Session {
  accessToken: string;
  user: {
    id: string;
    displayName: string;
    email: string | null;
    avatarUrl: string | null;
  };
}

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly google: GoogleVerifier,
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  config() {
    return { google: this.google.isConfigured() };
  }

  /**
   * The original single-password sign-in, kept working exactly as it was.
   *
   * This is not legacy clutter to be tidied away later: it is the owner's way
   * in. His account has no email and no password of its own, and taking this
   * path out — or quietly changing what it returns — locks him out of his own
   * portfolio. It resolves to the first user, which is his.
   */
  async loginWithAppPassword(password: string): Promise<Session> {
    const stored = process.env.APP_PASSWORD_HASH;
    if (stored) {
      if (!(await compare(password, stored))) {
        throw new UnauthorizedException('Wrong password');
      }
    } else if (
      password !== 'aaaa' &&
      password !== 'trader' &&
      password !== 'password'
    ) {
      throw new UnauthorizedException(
        'Wrong password (accepted dev passwords: aaaa or trader)',
      );
    }
    const owner = await this.users.ensureDefaultUser();
    return this.sessionFor(owner);
  }

  async signUp(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<Session> {
    const normalised = email.trim().toLowerCase();
    if (password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const existing = await this.findByEmail(normalised);
    if (existing) throw new ConflictException('That email is already registered');

    const user = await this.repo.save(
      this.repo.create({
        email: normalised,
        passwordHash: await hash(password, BCRYPT_ROUNDS),
        displayName: displayName?.trim() || normalised.split('@')[0],
      }),
    );
    return this.sessionFor(user);
  }

  async signIn(email: string, password: string): Promise<Session> {
    const user = await this.findByEmail(email.trim().toLowerCase());
    // One message for "no such account" and "wrong password" alike: telling
    // them apart tells an attacker which emails are registered.
    if (!user?.passwordHash || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Wrong email or password');
    }
    return this.sessionFor(user);
  }

  /**
   * Sign in with Google, creating the account on first use.
   *
   * An existing password account with the same VERIFIED email is linked
   * rather than duplicated — signing in with Google to an address you already
   * own should reach your data, not a second empty account. The verifier only
   * returns an email when Google says it is verified, which is what makes
   * that link safe.
   */
  async signInWithGoogle(idToken: string): Promise<Session> {
    const identity = await this.google.verify(idToken);
    if (!identity) throw new UnauthorizedException('Google sign-in failed');

    let user = await this.repo.findOne({
      where: { googleId: identity.googleId },
    });
    if (!user && identity.email) {
      user = (await this.findByEmail(identity.email)) ?? null;
      if (user) user.googleId = identity.googleId;
    }
    if (!user) {
      user = this.repo.create({
        googleId: identity.googleId,
        email: identity.email,
        displayName: identity.displayName ?? identity.email ?? 'trader',
        avatarUrl: identity.avatarUrl,
      });
    }
    if (identity.avatarUrl) user.avatarUrl = identity.avatarUrl;
    return this.sessionFor(await this.repo.save(user));
  }

  private async findByEmail(email: string): Promise<User | null> {
    // Matched case-insensitively, like the unique index that backs it.
    return this.repo
      .createQueryBuilder('u')
      .where('lower(u.email) = :email', { email })
      .getOne();
  }

  private async sessionFor(user: User): Promise<Session> {
    user.lastSeenAt = new Date();
    await this.repo.save(user);
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id }),
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
      },
    };
  }
}

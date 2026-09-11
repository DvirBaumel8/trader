import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { userContext } from './user-context.js';

/**
 * Puts the authenticated user's id where the services can find it.
 *
 * Middleware rather than a guard or an interceptor, because only middleware
 * reliably wraps the WHOLE downstream chain in the AsyncLocalStorage run: a
 * guard returns before the handler executes, and an interceptor hands back an
 * observable that Nest subscribes to outside the run.
 *
 * It verifies the token rather than merely decoding it. The guard would
 * reject a forged one before any handler ran, so decoding alone would be
 * safe in practice — but "safe because something else happens to reject it
 * first" is the kind of reasoning that stops being true after a refactor.
 *
 * A missing or bad token is not an error here. Public routes legitimately
 * have none, and rejecting is the guard's job, not this one's.
 */
@Injectable()
export class UserContextMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    let userId: string | null = null;

    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub?: string }>(token);
        // Tokens minted before multi-user carry sub: 'owner'. That is not a
        // user id, so it resolves to the default owner below rather than to
        // a lookup that would fail — an old token in a phone's storage must
        // not log anybody out.
        userId = payload.sub && payload.sub !== 'owner' ? payload.sub : null;
      } catch {
        userId = null;
      }
    }

    userContext.run({ userId }, () => next());
  }
}

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ALLOW_API_KEY } from './allow-api-key.decorator.js';
import { API_KEY_PREFIX } from '../users/api-key-format.js';
import { currentUserId } from '../users/user-context.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header = req.headers.authorization as string | undefined;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing token');

    if (token.startsWith(API_KEY_PREFIX)) {
      // The middleware has already resolved the key; here we only decide
      // whether this route may be reached with one.
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_API_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) throw new UnauthorizedException('API key not allowed here');
      if (!currentUserId()) throw new UnauthorizedException('Invalid API key');
      return true;
    }

    try {
      await this.jwt.verifyAsync(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

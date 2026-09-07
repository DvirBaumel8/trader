import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  async login(password: string): Promise<{ accessToken: string }> {
    const hash = process.env.APP_PASSWORD_HASH;
    if (hash) {
      if (!(await compare(password, hash))) {
        throw new UnauthorizedException('Wrong password');
      }
    } else {
      // In development when APP_PASSWORD_HASH is unset, allow 'trader' or 'password'
      if (password !== 'trader' && password !== 'password') {
        throw new UnauthorizedException('Wrong password (default dev password: trader)');
      }
    }
    return { accessToken: await this.jwt.signAsync({ sub: 'owner' }) };
  }
}

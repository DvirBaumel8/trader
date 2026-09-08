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
      // In development when APP_PASSWORD_HASH is unset, allow 'aaaa', 'trader', or 'password'
      if (password !== 'aaaa' && password !== 'trader' && password !== 'password') {
        throw new UnauthorizedException('Wrong password (accepted dev passwords: aaaa or trader)');
      }
    }
    return { accessToken: await this.jwt.signAsync({ sub: 'owner' }) };
  }
}

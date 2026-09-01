import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  async login(password: string): Promise<{ accessToken: string }> {
    const hash = process.env.APP_PASSWORD_HASH;
    if (!hash || !(await compare(password, hash))) {
      throw new UnauthorizedException('Wrong password');
    }
    return { accessToken: await this.jwt.signAsync({ sub: 'owner' }) };
  }
}

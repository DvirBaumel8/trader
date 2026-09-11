import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { GoogleSignInDto, SignInDto, SignUpDto } from './dto/accounts.dto.js';
import { Public } from './public.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * What sign-in methods this deployment actually has.
   *
   * Google needs GOOGLE_CLIENT_ID, which only the owner can create. Rather
   * than showing a button that fails, the frontend asks first — the same
   * shape the LLM's `configured` flag already uses.
   */
  @Public()
  @Get('config')
  config() {
    return this.auth.config();
  }

  /**
   * The original shared-password sign-in. Unchanged on the wire except that
   * it now also returns who signed in; the token field it already returned
   * keeps its name and meaning, so an app holding an old one keeps working.
   */
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.loginWithAppPassword(dto.password);
  }

  @Public()
  @Post('signup')
  signUp(@Body() dto: SignUpDto) {
    return this.auth.signUp(dto.email, dto.password, dto.displayName);
  }

  @Public()
  @Post('signin')
  signIn(@Body() dto: SignInDto) {
    return this.auth.signIn(dto.email, dto.password);
  }

  @Public()
  @Post('google')
  google(@Body() dto: GoogleSignInDto) {
    return this.auth.signInWithGoogle(dto.idToken);
  }
}

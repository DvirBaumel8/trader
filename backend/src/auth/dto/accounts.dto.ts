import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SignUpDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;
}

export class SignInDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

export class GoogleSignInDto {
  @IsString()
  @MaxLength(4096)
  idToken: string;
}

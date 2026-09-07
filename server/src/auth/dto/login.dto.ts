import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsLoginAccount } from './is-login-account';

export class LoginDto {
  @IsLoginAccount()
  @MaxLength(320)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;
}

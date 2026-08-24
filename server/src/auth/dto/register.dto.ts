import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;
}

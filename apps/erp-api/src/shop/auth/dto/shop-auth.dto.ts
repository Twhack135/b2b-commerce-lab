import { IsString, MaxLength } from 'class-validator';

// Requests of the shop BFF to /shop/v1/auth. The limits only protect the
// server (e.g. against hashing megabytes); the password rules are checked
// by the service and answered with readable messages.

export class LoginDto {
  @IsString()
  @MaxLength(320)
  email: string;

  @IsString()
  @MaxLength(1024)
  password: string;
}

export class ActivateDto {
  @IsString()
  @MaxLength(100)
  token: string;

  @IsString()
  @MaxLength(1024)
  password: string;
}

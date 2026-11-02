import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// The e-mail address and the account of a shop user cannot be changed: the
// address is the sign-in name, the account decides which units it may get.
export class UpdateShopUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  /** DISABLED ends all sessions at once (database trigger) */
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}

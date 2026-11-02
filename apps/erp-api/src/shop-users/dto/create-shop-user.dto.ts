import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// The e-mail address and the display name are normalized and checked by the
// shop user rules (and CHECK constraints); the limits here only keep the
// requests small.
export class CreateShopUserDto {
  @IsString()
  @MaxLength(20)
  accountCustomerNumber: string;

  @IsString()
  @MaxLength(320)
  email: string;

  @IsString()
  @MaxLength(200)
  displayName: string;

  /** Units of the same account the user may act for (optional) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  unitIds?: string[];
}

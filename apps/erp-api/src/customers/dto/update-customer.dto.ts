import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { IfPresent, IsCountryCode, IsNotBlank } from '../../common/validators';
import {
  CITY_MAX_LENGTH,
  IsPostalCode,
  NAME_MAX_LENGTH,
  POSTAL_CODE_MAX_LENGTH,
  STREET_MAX_LENGTH,
} from './customer-validators';

// customerNumber is intentionally not listed here: the primary key
// cannot be changed, and the ValidationPipe rejects unknown properties.
export class UpdateCustomerDto {
  @IfPresent()
  @IsString()
  @IsNotBlank()
  @MaxLength(NAME_MAX_LENGTH)
  name?: string;

  @IfPresent()
  @IsString()
  @IsNotBlank()
  @MaxLength(STREET_MAX_LENGTH)
  street?: string;

  @IfPresent()
  @IsString()
  @IsPostalCode()
  @MaxLength(POSTAL_CODE_MAX_LENGTH)
  postalCode?: string;

  @IfPresent()
  @IsString()
  @IsNotBlank()
  @MaxLength(CITY_MAX_LENGTH)
  city?: string;

  @IfPresent()
  @IsCountryCode()
  country?: string;

  @IfPresent()
  @IsBoolean()
  isActive?: boolean;
}

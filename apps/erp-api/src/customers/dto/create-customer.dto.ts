import { IsBoolean, IsString, MaxLength } from 'class-validator';
import {
  IfPresent,
  IsBusinessKey,
  IsCountryCode,
  IsNotBlank,
} from '../../common/validators';
import {
  CITY_MAX_LENGTH,
  CUSTOMER_NUMBER_MAX_LENGTH,
  IsPostalCode,
  NAME_MAX_LENGTH,
  POSTAL_CODE_MAX_LENGTH,
  STREET_MAX_LENGTH,
} from './customer-validators';

export class CreateCustomerDto {
  @IsString()
  @IsBusinessKey()
  @MaxLength(CUSTOMER_NUMBER_MAX_LENGTH)
  customerNumber: string;

  @IsString()
  @IsNotBlank()
  @MaxLength(NAME_MAX_LENGTH)
  name: string;

  @IsString()
  @IsNotBlank()
  @MaxLength(STREET_MAX_LENGTH)
  street: string;

  @IsString()
  @IsPostalCode()
  @MaxLength(POSTAL_CODE_MAX_LENGTH)
  postalCode: string;

  @IsString()
  @IsNotBlank()
  @MaxLength(CITY_MAX_LENGTH)
  city: string;

  @IsCountryCode()
  country: string;

  // Optional; new customers are active unless stated otherwise
  @IfPresent()
  @IsBoolean()
  isActive?: boolean;
}

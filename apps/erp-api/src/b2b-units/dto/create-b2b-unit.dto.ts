import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { IfPresent, IsBusinessKey, IsNotBlank } from '../../common/validators';
import {
  IsCustomerReference,
  IsShipToList,
  UNIT_ID_MAX_LENGTH,
  UNIT_NAME_MAX_LENGTH,
} from './b2b-unit-validators';

export class CreateB2bUnitDto {
  @IsString()
  @IsBusinessKey()
  @MaxLength(UNIT_ID_MAX_LENGTH)
  unitId: string;

  @IsString()
  @IsNotBlank()
  @MaxLength(UNIT_NAME_MAX_LENGTH)
  name: string;

  // Account and Sold-to are fixed after creation
  @IsCustomerReference()
  accountCustomerNumber: string;

  @IsCustomerReference()
  soldToCustomerNumber: string;

  @IsCustomerReference()
  billToCustomerNumber: string;

  @IsCustomerReference()
  payerCustomerNumber: string;

  @IsShipToList()
  shipToCustomerNumbers: string[];

  @IsCustomerReference()
  defaultShipToCustomerNumber: string;

  // Optional; new units are active unless stated otherwise
  @IfPresent()
  @IsBoolean()
  isActive?: boolean;
}

import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { IfPresent, IsBusinessKey, IsNotBlank } from '../../common/validators';
import {
  IsSalesAreaPartCode,
  IsSalesOrganizationCode,
} from '../../sales-areas/sales-area-validators';
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

  // Sales area, account and Sold-to are fixed after creation. All partners
  // must be assigned to the sales area.
  @IsSalesOrganizationCode()
  salesOrganization: string;

  @IsSalesAreaPartCode()
  distributionChannel: string;

  @IsSalesAreaPartCode()
  division: string;

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

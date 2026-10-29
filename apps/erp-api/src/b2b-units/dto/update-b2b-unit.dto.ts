import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { IfPresent, IsNotBlank } from '../../common/validators';
import {
  IsCustomerReference,
  IsShipToList,
  UNIT_NAME_MAX_LENGTH,
} from './b2b-unit-validators';

// unitId, accountCustomerNumber and soldToCustomerNumber are intentionally
// not listed: they cannot be changed, and the ValidationPipe rejects
// unknown properties.
export class UpdateB2bUnitDto {
  @IfPresent()
  @IsString()
  @IsNotBlank()
  @MaxLength(UNIT_NAME_MAX_LENGTH)
  name?: string;

  @IfPresent()
  @IsCustomerReference()
  billToCustomerNumber?: string;

  @IfPresent()
  @IsCustomerReference()
  payerCustomerNumber?: string;

  /** Replaces the complete list of allowed ship-tos */
  @IfPresent()
  @IsShipToList()
  shipToCustomerNumbers?: string[];

  @IfPresent()
  @IsCustomerReference()
  defaultShipToCustomerNumber?: string;

  @IfPresent()
  @IsBoolean()
  isActive?: boolean;
}

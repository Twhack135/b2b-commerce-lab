import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { UNIT_ID_MAX_LENGTH } from '../../b2b-units/dto/b2b-unit-validators';
import {
  IfPresent,
  IsBusinessKey,
  IsCalendarDate,
} from '../../common/validators';
import {
  IsSalesAreaPartCode,
  IsSalesOrganizationCode,
} from '../../sales-areas/sales-area-validators';

export const MAX_QUANTITY = 99_999;

export class CalculatePriceDto {
  @IsString()
  @IsBusinessKey()
  materialNumber: string;

  // Required: prices exist per sales area. The server checks that it is
  // configured, active and the sales area of the unit, and takes the
  // currency from it.
  @IsSalesOrganizationCode()
  salesOrganization: string;

  @IsSalesAreaPartCode()
  distributionChannel: string;

  @IsSalesAreaPartCode()
  division: string;

  // The Sold-to is taken from the unit
  @IsString()
  @IsBusinessKey()
  @MaxLength(UNIT_ID_MAX_LENGTH)
  unitId: string;

  // Required, so the result never depends on the server's clock or time zone
  @IsCalendarDate()
  pricingDate: string;

  // Optional; a price for one piece unless stated otherwise
  @IfPresent()
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity?: number;
}

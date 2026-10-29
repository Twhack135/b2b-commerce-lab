import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { UNIT_ID_MAX_LENGTH } from '../../b2b-units/dto/b2b-unit-validators';
import {
  IfPresent,
  IsBusinessKey,
  IsCalendarDate,
} from '../../common/validators';

export const MAX_QUANTITY = 99_999;

export class CalculatePriceDto {
  @IsString()
  @IsBusinessKey()
  materialNumber: string;

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

import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { UNIT_ID_MAX_LENGTH } from '../../b2b-units/dto/b2b-unit-validators';
import {
  IfPresent,
  IsBusinessKey,
  IsCalendarDate,
} from '../../common/validators';
import { CUSTOMER_NUMBER_MAX_LENGTH } from '../../customers/dto/customer-validators';
import { PriceConditionScope } from '../../generated/prisma/enums';
import { IsCurrencyCode } from '../../materials/dto/material-validators';
import { IsAmount, IsScopeKey } from './price-condition-validators';

export class CreatePriceConditionDto {
  // Material, scope and key (Sold-to or unit) are fixed after creation
  @IsString()
  @IsBusinessKey()
  materialNumber: string;

  @IsEnum(PriceConditionScope, {
    message: 'scope must be one of: B2B_UNIT, SOLD_TO',
  })
  scope: PriceConditionScope;

  @IsScopeKey(PriceConditionScope.SOLD_TO, CUSTOMER_NUMBER_MAX_LENGTH)
  soldToCustomerNumber?: string;

  @IsScopeKey(PriceConditionScope.B2B_UNIT, UNIT_ID_MAX_LENGTH)
  unitId?: string;

  @IsAmount()
  amount: string;

  // Must be the currency of the material; it is sent anyway, so a client
  // never stores a price in a currency it did not expect
  @IsCurrencyCode()
  currency: string;

  @IsCalendarDate()
  validFrom: string;

  // Optional; missing or null means open-ended
  @IsOptional()
  @IsCalendarDate()
  validTo?: string | null;

  // Optional; new conditions are active unless stated otherwise
  @IfPresent()
  @IsBoolean()
  isActive?: boolean;
}

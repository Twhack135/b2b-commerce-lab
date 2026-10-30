import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { UNIT_ID_MAX_LENGTH } from '../../b2b-units/dto/b2b-unit-validators';
import {
  IfPresent,
  IsBusinessKey,
  IsCalendarDate,
} from '../../common/validators';
import { CUSTOMER_NUMBER_MAX_LENGTH } from '../../customers/dto/customer-validators';
import { PriceConditionScope } from '../../generated/prisma/enums';
import { IsCurrencyCode } from '../../materials/dto/material-validators';
import {
  IsSalesAreaPartCode,
  IsSalesOrganizationCode,
} from '../../sales-areas/sales-area-validators';
import { IsAmount, IsScopeKey } from './price-condition-validators';

export class CreatePriceConditionDto {
  // Condition type, sales area, material, scope and key are fixed after
  // creation. Required: every condition record has a condition type, e.g.
  // ZP01 or ZP02. Which types can be used, and with which scopes, is
  // checked against the configuration.
  @IsString()
  @Matches(/^[A-Z0-9]{4}$/, {
    message:
      'conditionTypeCode must be a condition type code of 4 uppercase letters or digits (e.g. ZP02)',
  })
  conditionTypeCode: string;

  // Required: every price belongs to one sales area (market)
  @IsSalesOrganizationCode()
  salesOrganization: string;

  @IsSalesAreaPartCode()
  distributionChannel: string;

  @IsSalesAreaPartCode()
  division: string;

  @IsString()
  @IsBusinessKey()
  materialNumber: string;

  @IsEnum(PriceConditionScope, {
    message: 'scope must be one of: B2B_UNIT, SOLD_TO, SALES_AREA',
  })
  scope: PriceConditionScope;

  @IsScopeKey(PriceConditionScope.SOLD_TO, CUSTOMER_NUMBER_MAX_LENGTH)
  soldToCustomerNumber?: string;

  @IsScopeKey(PriceConditionScope.B2B_UNIT, UNIT_ID_MAX_LENGTH)
  unitId?: string;

  @IsAmount()
  amount: string;

  // Optional: the server takes the currency of the sales area. If a client
  // sends it, it must be that currency, so a client never stores a price
  // in a currency it did not expect.
  @IfPresent()
  @IsCurrencyCode()
  currency?: string;

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

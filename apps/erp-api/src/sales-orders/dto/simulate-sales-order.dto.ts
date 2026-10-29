import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  IsCustomerReference,
  UNIT_ID_MAX_LENGTH,
} from '../../b2b-units/dto/b2b-unit-validators';
import { IsBusinessKey, IsCalendarDate } from '../../common/validators';
import { MAX_QUANTITY } from '../../pricing/dto/calculate-price.dto';

/** Technical protection limit, not a business rule */
export const MAX_ITEMS = 200;
/** Length of a customer purchase order number (as SAP BSTKD) */
export const CUSTOMER_REFERENCE_MAX_LENGTH = 35;
export const CUSTOMER_NOTE_MAX_LENGTH = 1000;

/**
 * The shipping method the customer asks for. It is a request only: it does
 * not determine an SAP shipping condition, a delivery date or freight.
 */
export enum RequestedShippingMethod {
  STANDARD = 'STANDARD',
  EXPRESS = 'EXPRESS',
}

export class SimulationItemDto {
  @IsString()
  @IsBusinessKey()
  materialNumber: string;

  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity: number;
}

// Sold-to, Bill-to and Payer are intentionally not listed: they always come
// from the B2B unit, and the ValidationPipe rejects unknown properties.
export class SimulateSalesOrderDto {
  @IsString()
  @IsBusinessKey()
  @MaxLength(UNIT_ID_MAX_LENGTH)
  unitId: string;

  // Optional; the unit's default Ship-to is used if missing or null
  @IsOptional()
  @IsCustomerReference()
  shipToCustomerNumber?: string | null;

  // Required, so the result never depends on the server's clock
  @IsCalendarDate()
  pricingDate: string;

  // Optional; STANDARD unless stated otherwise
  @IsOptional()
  @IsEnum(RequestedShippingMethod, {
    message: 'requestedShippingMethod must be one of: STANDARD, EXPRESS',
  })
  requestedShippingMethod?: RequestedShippingMethod | null;

  // The customer's own purchase order number
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_REFERENCE_MAX_LENGTH)
  customerReference?: string | null;

  // Free text at header level; a non-empty note requires a Sales review
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOMER_NOTE_MAX_LENGTH)
  customerNote?: string | null;

  // Positions in request order; the same material may occur several times
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => SimulationItemDto)
  items: SimulationItemDto[];
}

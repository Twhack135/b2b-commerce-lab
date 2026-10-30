import { applyDecorators } from '@nestjs/common';
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
import {
  IsSalesAreaPartCode,
  IsSalesOrganizationCode,
} from '../../sales-areas/sales-area-validators';

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

/** A position as the ERP API evaluates it */
export interface OrderItemInput {
  materialNumber: string;
  quantity: number;
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

/**
 * Positions in request order, validated as instances of `itemType`; the same
 * material may occur several times. Shared by simulation and creation.
 */
export function IsOrderItems(itemType: () => new () => object) {
  return applyDecorators(
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(MAX_ITEMS),
    ValidateNested({ each: true }),
    Type(itemType),
  );
}

// Sold-to, Bill-to and Payer are intentionally not listed: they always come
// from the B2B unit, and the ValidationPipe rejects unknown properties.
// The order header, shared by the simulation and the creation of sales
// orders; each declares its own positions. Prices are never taken from a
// request, the ERP API determines them.
export class OrderRequestDto {
  // Required: the order is simulated in this sales area (the shop context).
  // The server checks it and takes the document currency from it; the unit
  // must belong to it.
  @IsSalesOrganizationCode()
  salesOrganization: string;

  @IsSalesAreaPartCode()
  distributionChannel: string;

  @IsSalesAreaPartCode()
  division: string;

  @IsString()
  @IsBusinessKey()
  @MaxLength(UNIT_ID_MAX_LENGTH)
  unitId: string;

  // Optional; the unit's default Ship-to is used if missing or null
  @IsOptional()
  @IsCustomerReference()
  shipToCustomerNumber?: string | null;

  // Optional wish of the customer; informational only. It is not confirmed
  // and never changes the pricing date. Must not be before the order date.
  @IsOptional()
  @IsCalendarDate()
  requestedDeliveryDate?: string | null;

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
}

/** What the ERP API evaluates: the order header with its positions */
export type OrderRequest = OrderRequestDto & { items: OrderItemInput[] };

export class SimulateSalesOrderDto extends OrderRequestDto {
  // Positions in request order; the same material may occur several times
  @IsOrderItems(() => SimulationItemDto)
  items: SimulationItemDto[];

  // The order date; business rule: pricing date = order date. Required, so
  // the simulation never depends on the server's clock. Creating a sales
  // order does not accept it: there the ERP API determines the order date
  // in the time zone of the sales organization (Sprint 10B).
  @IsCalendarDate()
  pricingDate: string;
}

import { Type } from 'class-transformer';
import { IsObject, IsUUID, Matches, ValidateNested } from 'class-validator';
import {
  IsOrderItems,
  OrderRequestDto,
  SimulationItemDto,
} from './simulate-sales-order.dto';

/**
 * A non-negative amount with at most two decimal places and up to 18 digits
 * before the decimal point (the database stores net values as DECIMAL(20, 2))
 */
const NET_VALUE_PATTERN = /^(0|[1-9]\d{0,17})(\.\d{1,2})?$/;

/**
 * The total the user has seen and confirmed (from the simulation). It is
 * only compared with the total the ERP API determines when creating the
 * order; it never sets a price.
 */
export class ExpectedTotalDto {
  @Matches(NET_VALUE_PATTERN, {
    message:
      'netValue must be a decimal string with at most two decimal places, e.g. "10695.00"',
  })
  netValue: string;

  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a three-letter currency code, e.g. EUR',
  })
  currency: string;
}

/**
 * A non-negative price per piece with at most two decimal places and up to
 * 10 digits before the decimal point (like the amount of a price condition)
 */
const UNIT_PRICE_PATTERN = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/;

/**
 * A position with the unit price the user has seen and confirmed for it (from
 * the simulation). The ERP API determines the price itself and only compares
 * it; a different price is answered with PRICE_CHANGED, never stored.
 * Being part of the position, it belongs unambiguously to it, also when the
 * same material occurs in several positions.
 */
export class CreateSalesOrderItemDto extends SimulationItemDto {
  @Matches(UNIT_PRICE_PATTERN, {
    message:
      'expectedUnitPrice must be a decimal string with at most two decimal places, e.g. "189.50"',
  })
  expectedUnitPrice: string;
}

// Same order data as the simulation, but without a pricing date: the ERP
// API sets the order date itself, in the time zone of the sales organization.
export class CreateSalesOrderDto extends OrderRequestDto {
  // Positions in request order, each with its confirmed unit price
  @IsOrderItems(() => CreateSalesOrderItemDto)
  items: CreateSalesOrderItemDto[];

  // Created by the client for one creation attempt. A retry after a network
  // error sends the same ID with the same data and receives the same order;
  // a new attempt (e.g. after PRICE_CHANGED) uses a new ID.
  @IsUUID('all', { message: 'requestId must be a UUID' })
  requestId: string;

  @IsObject()
  @ValidateNested()
  @Type(() => ExpectedTotalDto)
  expectedTotal: ExpectedTotalDto;
}

import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { RequestedShippingMethod } from './dto/simulate-sales-order.dto';
import { optionalText } from './simulation-rules';

/** Changes whenever the canonical form below changes */
const CANONICAL_VERSION = 'sales-order-request/v2';

/**
 * The business content of a creation request in a fixed form: every field
 * that influences the order, in a fixed order, with defaults applied and
 * equal values written the same way (an empty note is null, "10695.00" and
 * "10695.0" are the same total). The request ID itself is not part of it.
 * Two requests with the same canonical form would create the same order.
 */
export function canonicalOrderRequest(dto: CreateSalesOrderDto): string {
  return JSON.stringify([
    CANONICAL_VERSION,
    dto.salesOrganization,
    dto.distributionChannel,
    dto.division,
    dto.unitId,
    optionalText(dto.shipToCustomerNumber),
    dto.requestedDeliveryDate ?? null,
    dto.requestedShippingMethod ?? RequestedShippingMethod.STANDARD,
    optionalText(dto.customerReference),
    optionalText(dto.customerNote),
    // Positions in request order: the order of items is part of the order
    dto.items.map((item) => [
      item.materialNumber,
      item.quantity,
      new Prisma.Decimal(item.expectedUnitPrice).toFixed(),
    ]),
    new Prisma.Decimal(dto.expectedTotal.netValue).toFixed(),
    dto.expectedTotal.currency,
  ]);
}

/** SHA-256 (hex) of the canonical request */
export function hashOrderRequest(dto: CreateSalesOrderDto): string {
  return createHash('sha256')
    .update(canonicalOrderRequest(dto), 'utf8')
    .digest('hex');
}

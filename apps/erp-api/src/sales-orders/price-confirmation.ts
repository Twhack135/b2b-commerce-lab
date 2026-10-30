import { Prisma } from '../generated/prisma/client';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { SalesOrderSimulation } from './sales-order-simulation.interface';

/** A position whose price differs from the price the user confirmed */
export interface ChangedItemPrice {
  itemNumber: number;
  materialNumber: string;
  quantity: number;
  expectedUnitPrice: string;
  /** The price the ERP API determined now; null if there is none */
  unitPrice: string | null;
}

/** Differences between the confirmed and the current prices of an order */
export interface PriceChanges {
  items: ChangedItemPrice[];
  /** The total or its currency differs */
  total: boolean;
}

/**
 * Compares the prices the user confirmed with the prices the ERP API has just
 * determined: every position on its own (position i of the request with
 * position i of the evaluation, so equal materials in several positions are
 * compared separately) and the total with its currency. All comparisons are
 * exact decimal comparisons; "189.5" equals "189.50". The confirmed values are
 * only compared, never used as prices.
 */
export function priceChanges(
  simulation: SalesOrderSimulation,
  dto: Pick<CreateSalesOrderDto, 'items' | 'expectedTotal'>,
): PriceChanges {
  const items: ChangedItemPrice[] = [];
  simulation.items.forEach((item, index) => {
    const expected = dto.items[index].expectedUnitPrice;
    if (
      item.unitPrice === null ||
      !new Prisma.Decimal(item.unitPrice).equals(expected)
    ) {
      items.push({
        itemNumber: item.itemNumber,
        materialNumber: item.materialNumber,
        quantity: item.quantity,
        expectedUnitPrice: expected,
        unitPrice: item.unitPrice,
      });
    }
  });

  const totals = simulation.totals;
  const total =
    !totals ||
    totals.currency !== dto.expectedTotal.currency ||
    !new Prisma.Decimal(totals.netValue).equals(dto.expectedTotal.netValue);

  return { items, total };
}

/** The explanation for a PRICE_CHANGED answer */
export function priceChangeMessages(
  changes: PriceChanges,
  simulation: SalesOrderSimulation,
  dto: Pick<CreateSalesOrderDto, 'expectedTotal'>,
): string[] {
  const currency = simulation.currency ?? '';
  const messages = changes.items.map(
    (item) =>
      `The price of item ${item.itemNumber} (${item.materialNumber}) is now ${item.unitPrice ?? 'not available'} ${currency} instead of the confirmed ${item.expectedUnitPrice} ${currency}.`,
  );
  if (changes.total && simulation.totals) {
    const { netValue, currency: totalCurrency } = simulation.totals;
    messages.push(
      `The order total is now ${netValue} ${totalCurrency} instead of the confirmed ${dto.expectedTotal.netValue} ${dto.expectedTotal.currency}.`,
    );
  }
  messages.push(
    'Nothing was stored; review the new prices and confirm the order again.',
  );
  return messages;
}

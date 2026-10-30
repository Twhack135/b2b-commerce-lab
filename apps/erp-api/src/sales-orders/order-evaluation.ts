import { Prisma } from '../generated/prisma/client';
import { ItemPricing, PricingService } from '../pricing/pricing.service';
import {
  findSalesArea,
  salesAreaKeyOf,
  sameSalesArea,
  SalesAreaWithCurrency,
} from '../sales-areas/sales-area-key';
import {
  OrderRequest,
  RequestedShippingMethod,
} from './dto/simulate-sales-order.dto';
import { SalesOrderSimulation } from './sales-order-simulation.interface';
import {
  buildItems,
  checksOf,
  currencyMessages,
  customerNoteResult,
  optionalText,
  requestedDeliveryDateMessages,
  resolvePartners,
  salesAreaMessages,
  sameMaterialMessages,
  shippingMessages,
  simulationStatus,
  SimulationUnit,
  totalsOf,
} from './simulation-rules';
import { findOrderUnit } from './order-unit';

/** Everything the evaluation of an order has read and decided */
export interface OrderEvaluation {
  /** The business result, exactly as POST /sales-orders/simulate returns it */
  simulation: SalesOrderSimulation;
  /** The unit with its partners as read (null if it does not exist) */
  unit: SimulationUnit | null;
  salesArea: SalesAreaWithCurrency | null;
  /** Pricing per position, in request order */
  pricings: ItemPricing[];
}

/**
 * Evaluates an order in a sales area on a pricing date (= order date):
 * resolves the partners of the B2B unit, prices every position in the
 * currency of the sales area and reports all business problems at once.
 * Nothing is priced if the sales area cannot be used or the unit belongs to
 * another sales area.
 *
 * Shared by the simulation (read-only transaction, client order date) and
 * the creation of sales orders (write transaction, server order date), so
 * both always apply the same rules and the same prices. The queries run one
 * after the other on `db`, which must be a transaction client.
 */
export async function evaluateOrder(
  db: Prisma.TransactionClient,
  pricing: PricingService,
  request: OrderRequest,
  pricingDate: string,
): Promise<OrderEvaluation> {
  const shippingMethod =
    request.requestedShippingMethod ?? RequestedShippingMethod.STANDARD;
  const customerNote = optionalText(request.customerNote);
  const customerReference = optionalText(request.customerReference);
  const requestedDeliveryDate = request.requestedDeliveryDate ?? null;

  const key = salesAreaKeyOf(request);

  const unit = await findOrderUnit(db, request.unitId);
  const salesArea = await findSalesArea(db, key);
  const canPrice =
    salesArea !== null &&
    salesArea.isActive &&
    unit !== null &&
    sameSalesArea(unit, key);
  const pricings = await pricing.priceItems(
    {
      unit: canPrice ? unit : null,
      salesArea: canPrice ? salesArea : null,
      pricingDate,
      items: request.items,
    },
    db,
  );

  const salesAreaErrors = salesAreaMessages(key, salesArea, unit);
  const partnerResult = resolvePartners(
    unit,
    request.unitId,
    optionalText(request.shipToCustomerNumber),
  );
  const { items, netValues } = buildItems(request.items, pricings, {
    salesArea: key,
    pricingDate,
    currency: salesArea?.currency ?? null,
  });
  const currencyErrors = currencyMessages(items);
  const note = customerNoteResult(customerNote);

  const messages = [
    ...salesAreaErrors,
    ...partnerResult.messages,
    ...currencyErrors,
    ...requestedDeliveryDateMessages(requestedDeliveryDate, pricingDate),
    ...note.messages,
    ...shippingMessages(shippingMethod),
    ...sameMaterialMessages(items),
  ];
  const status = simulationStatus(messages, items);

  const simulation: SalesOrderSimulation = {
    simulated: true,
    status,
    salesArea: key,
    currency: salesArea?.currency.code ?? null,
    pricingDate,
    requestedDeliveryDate,
    requestedShippingMethod: shippingMethod,
    customerReference,
    customerNote,
    partners: partnerResult.partners,
    items,
    totals: totalsOf(status, netValues, salesArea?.currency ?? null),
    requiresSalesReview: note.requiresSalesReview,
    proposedOrderBlock: note.proposedOrderBlock,
    checks: checksOf(
      salesAreaErrors,
      partnerResult.messages,
      items,
      currencyErrors,
    ),
    messages,
  };
  return { simulation, unit, salesArea, pricings };
}

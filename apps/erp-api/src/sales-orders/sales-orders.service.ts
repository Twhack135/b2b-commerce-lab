import { Injectable } from '@nestjs/common';
import { PricingService } from '../pricing/pricing.service';
import { readOnlyTransaction } from '../prisma/read-only-transaction';
import { PrismaService } from '../prisma/prisma.service';
import {
  RequestedShippingMethod,
  SimulateSalesOrderDto,
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
  sameMaterialMessages,
  shippingMessages,
  simulationStatus,
  totalsOf,
  UNIT_INCLUDE,
} from './simulation-rules';

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Simulates a sales order: resolves the partners of the B2B unit, prices
   * every position and reports all business problems at once. All reads run
   * in one read-only REPEATABLE READ transaction, so the simulation sees one
   * consistent state and can never change data. No sales order, delivery
   * block or stock reservation is created.
   */
  async simulate(dto: SimulateSalesOrderDto): Promise<SalesOrderSimulation> {
    const shippingMethod =
      dto.requestedShippingMethod ?? RequestedShippingMethod.STANDARD;
    const customerNote = optionalText(dto.customerNote);
    const customerReference = optionalText(dto.customerReference);
    const requestedDeliveryDate = dto.requestedDeliveryDate ?? null;

    const { unit, pricings } = await readOnlyTransaction(
      this.prisma,
      async (tx) => {
        const unit = await tx.b2bUnit.findUnique({
          where: { unitId: dto.unitId },
          include: UNIT_INCLUDE,
        });
        const pricings = await this.pricing.priceItems(
          {
            unit,
            pricingDate: dto.pricingDate,
            items: dto.items,
          },
          tx,
        );
        return { unit, pricings };
      },
    );

    const partnerResult = resolvePartners(
      unit,
      dto.unitId,
      optionalText(dto.shipToCustomerNumber),
    );
    const { items, netValues } = buildItems(dto.items, pricings);
    const currencyErrors = currencyMessages(items);
    const note = customerNoteResult(customerNote);

    const messages = [
      ...partnerResult.messages,
      ...currencyErrors,
      ...requestedDeliveryDateMessages(requestedDeliveryDate, dto.pricingDate),
      ...note.messages,
      ...shippingMessages(shippingMethod),
      ...sameMaterialMessages(items),
    ];
    const status = simulationStatus(messages, items);

    return {
      simulated: true,
      status,
      pricingDate: dto.pricingDate,
      requestedDeliveryDate,
      requestedShippingMethod: shippingMethod,
      customerReference,
      customerNote,
      partners: partnerResult.partners,
      items,
      totals: totalsOf(status, items, netValues),
      requiresSalesReview: note.requiresSalesReview,
      proposedOrderBlock: note.proposedOrderBlock,
      checks: checksOf(partnerResult.messages, items, currencyErrors),
      messages,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { PricingService } from '../pricing/pricing.service';
import { readOnlyTransaction } from '../prisma/read-only-transaction';
import { PrismaService } from '../prisma/prisma.service';
import {
  findSalesArea,
  salesAreaKeyOf,
  sameSalesArea,
} from '../sales-areas/sales-area-key';
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
  salesAreaMessages,
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
   * Simulates a sales order in a sales area: resolves the partners of the
   * B2B unit, prices every position in the currency of the sales area and
   * reports all business problems at once. Nothing is priced if the sales
   * area cannot be used or the unit belongs to another sales area. All reads run
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

    const key = salesAreaKeyOf(dto);

    const { unit, salesArea, pricings } = await readOnlyTransaction(
      this.prisma,
      async (tx) => {
        const unit = await tx.b2bUnit.findUnique({
          where: { unitId: dto.unitId },
          include: UNIT_INCLUDE,
        });
        const salesArea = await findSalesArea(tx, key);
        const canPrice =
          salesArea !== null &&
          salesArea.isActive &&
          unit !== null &&
          sameSalesArea(unit, key);
        const pricings = await this.pricing.priceItems(
          {
            unit: canPrice ? unit : null,
            salesArea: canPrice ? salesArea : null,
            pricingDate: dto.pricingDate,
            items: dto.items,
          },
          tx,
        );
        return { unit, salesArea, pricings };
      },
    );

    const salesAreaErrors = salesAreaMessages(key, salesArea, unit);
    const partnerResult = resolvePartners(
      unit,
      dto.unitId,
      optionalText(dto.shipToCustomerNumber),
    );
    const { items, netValues } = buildItems(dto.items, pricings, {
      salesArea: key,
      pricingDate: dto.pricingDate,
      currency: salesArea?.currency ?? null,
    });
    const currencyErrors = currencyMessages(items);
    const note = customerNoteResult(customerNote);

    const messages = [
      ...salesAreaErrors,
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
      salesArea: key,
      currency: salesArea?.currency.code ?? null,
      pricingDate: dto.pricingDate,
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
  }
}

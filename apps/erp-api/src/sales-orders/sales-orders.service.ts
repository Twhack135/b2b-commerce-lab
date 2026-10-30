import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Clock } from '../common/clock';
import { calendarDateIn } from '../common/dates';
import { Prisma } from '../generated/prisma/client';
import { PricingService } from '../pricing/pricing.service';
import {
  isPostgresError,
  isPrismaError,
  UNIQUE_CONSTRAINT_FAILED,
} from '../prisma/prisma-errors';
import { readOnlyTransaction } from '../prisma/read-only-transaction';
import { PrismaService } from '../prisma/prisma.service';
import { salesAreaKeyOf } from '../sales-areas/sales-area-key';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { SimulateSalesOrderDto } from './dto/simulate-sales-order.dto';
import { evaluateOrder, OrderEvaluation } from './order-evaluation';
import { lockOrderData } from './order-locks';
import { priceChangeMessages, priceChanges } from './price-confirmation';
import { hashOrderRequest } from './request-hash';
import { SalesOrder } from './sales-order.interface';
import {
  ORDER_INCLUDE,
  SalesOrderRecord,
  salesOrderRows,
  toSalesOrder,
} from './sales-order-document';
import { SalesOrderSimulation } from './sales-order-simulation.interface';
import { optionalText } from './simulation-rules';

/** Error codes of POST /sales-orders */
export const ORDER_INVALID = 'ORDER_INVALID';
export const PRICE_CHANGED = 'PRICE_CHANGED';
export const IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED';
export const CONCURRENT_UPDATE = 'CONCURRENT_UPDATE';

/** Time zone used for orders in a sales organization that does not exist */
const FALLBACK_TIME_ZONE = 'UTC';

// PostgreSQL: deadlock detected, could not serialize access
const DEADLOCK_DETECTED = '40P01';
const SERIALIZATION_FAILURE = '40001';

@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly clock: Clock,
  ) {}

  /**
   * Simulates a sales order in a sales area on the requested pricing date
   * (see evaluateOrder). All reads run in one read-only REPEATABLE READ
   * transaction, so the simulation sees one consistent state and can never
   * change data. No sales order, delivery block or stock reservation is
   * created.
   */
  async simulate(dto: SimulateSalesOrderDto): Promise<SalesOrderSimulation> {
    const { simulation } = await readOnlyTransaction(this.prisma, (tx) =>
      evaluateOrder(tx, this.pricing, dto, dto.pricingDate),
    );
    return simulation;
  }

  /**
   * Creates a sales order. The ERP API evaluates and prices the order again
   * on today's date in the time zone of the sales organization; prices from
   * the client are never used. The order is stored only if it has no errors
   * and its total equals the total the user confirmed (`expectedTotal`).
   *
   * Idempotent per `requestId`: repeating a request (e.g. after a timeout)
   * returns the order already created for it, unchanged and without pricing
   * it again. `created` is false in that case.
   */
  async create(
    dto: CreateSalesOrderDto,
  ): Promise<{ order: SalesOrder; created: boolean }> {
    const requestHash = hashOrderRequest(dto);
    const existing = await this.findByRequestId(dto.requestId);
    if (existing) {
      return { order: replay(existing, requestHash), created: false };
    }

    let salesOrderNumber: string;
    try {
      salesOrderNumber = await this.prisma.$transaction(
        (tx) => this.createInTransaction(tx, dto, requestHash),
        // Lock waits for concurrent writers count towards the timeout
        { maxWait: 5_000, timeout: 20_000 },
      );
    } catch (error) {
      // A concurrent request with the same requestId was faster
      if (isPrismaError(error, UNIQUE_CONSTRAINT_FAILED)) {
        const winner = await this.findByRequestId(dto.requestId);
        if (winner) {
          return { order: replay(winner, requestHash), created: false };
        }
      }
      if (
        isPostgresError(error, DEADLOCK_DETECTED) ||
        isPostgresError(error, SERIALIZATION_FAILURE)
      ) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          code: CONCURRENT_UPDATE,
          message: [
            'The order data was changed at the same time. Nothing was stored; send the same request again.',
          ],
        });
      }
      throw error;
    }
    return { order: await this.findOne(salesOrderNumber), created: true };
  }

  /** A stored sales order, exactly as it was created */
  async findOne(salesOrderNumber: string): Promise<SalesOrder> {
    const record = await this.prisma.salesOrder.findUnique({
      where: { salesOrderNumber },
      include: ORDER_INCLUDE,
    });
    if (!record) {
      throw new NotFoundException(`Sales order ${salesOrderNumber} not found`);
    }
    return toSalesOrder(record);
  }

  private findByRequestId(requestId: string): Promise<SalesOrderRecord | null> {
    return this.prisma.salesOrder.findUnique({
      where: { requestId },
      include: ORDER_INCLUDE,
    });
  }

  /**
   * Locks, evaluates and stores the order in one transaction (READ
   * COMMITTED): first the rows the order depends on are locked (see
   * lockOrderData), then everything is read again, so all reads see the same
   * committed state, which no other transaction can change until the order
   * is committed. Returns the new sales order number.
   */
  private async createInTransaction(
    tx: Prisma.TransactionClient,
    dto: CreateSalesOrderDto,
    requestHash: string,
  ): Promise<string> {
    const key = salesAreaKeyOf(dto);
    await lockOrderData(tx, {
      unitId: dto.unitId,
      shipToCustomerNumber: optionalText(dto.shipToCustomerNumber),
      salesArea: key,
      materialNumbers: dto.items.map((item) => item.materialNumber),
    });

    // Order date = pricing date: today in the time zone of the sales
    // organization, never a date from the client
    const organization = await tx.salesOrganization.findUnique({
      where: { code: key.salesOrganization },
      select: { timeZone: true },
    });
    const timeZone = organization?.timeZone ?? FALLBACK_TIME_ZONE;
    const orderDate = calendarDateIn(timeZone, this.clock.now());

    const evaluation = await evaluateOrder(tx, this.pricing, dto, orderDate);
    checkCreatable(evaluation, dto);

    const [{ number }] = await tx.$queryRaw<{ number: string }[]>`
      SELECT nextval('sales_order_number_seq')::text AS number`;
    const rows = salesOrderRows(evaluation, {
      salesOrderNumber: number,
      requestId: dto.requestId,
      requestHash,
      orderDate,
      timeZone,
    });
    await tx.salesOrder.create({ data: rows.header });
    await tx.salesOrderPartner.createMany({ data: rows.partners });
    await tx.salesOrderItem.createMany({ data: rows.items });
    await tx.salesOrderItemCondition.createMany({ data: rows.conditions });
    return number;
  }
}

/**
 * Rejects an order with errors (422) and an order whose item prices or total
 * differ from what the user confirmed (409). Both answers contain the
 * complete, current evaluation, so the client can show what changed.
 */
function checkCreatable(evaluation: OrderEvaluation, dto: CreateSalesOrderDto) {
  const { simulation } = evaluation;
  if (simulation.status === 'INVALID' || !simulation.totals) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'Unprocessable Entity',
      code: ORDER_INVALID,
      message: [
        'The order has errors and was not created. Resolve them and confirm the order again.',
      ],
      evaluation: simulation,
    });
  }
  // Every position on its own: changes in opposite directions may leave the
  // total unchanged
  const changes = priceChanges(simulation, dto);
  if (changes.items.length > 0 || changes.total) {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: PRICE_CHANGED,
      message: priceChangeMessages(changes, simulation, dto),
      changedItems: changes.items,
      expectedTotal: {
        netValue: dto.expectedTotal.netValue,
        currency: dto.expectedTotal.currency,
      },
      evaluation: simulation,
    });
  }
}

/**
 * The order already created for a request ID. Only the identical request
 * may be repeated; the stored order is returned as it is, never priced again.
 */
function replay(record: SalesOrderRecord, requestHash: string): SalesOrder {
  if (record.requestHash !== requestHash) {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: IDEMPOTENCY_KEY_REUSED,
      message: [
        `requestId ${record.requestId} was already used for sales order ${record.salesOrderNumber} with different order data. Use a new requestId for a new order.`,
      ],
      salesOrderNumber: record.salesOrderNumber,
    });
  }
  return toSalesOrder(record);
}

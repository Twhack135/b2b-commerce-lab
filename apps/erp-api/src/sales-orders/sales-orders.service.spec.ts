import { Test, TestingModule } from '@nestjs/testing';
import { Clock } from '../common/clock';
import { Prisma } from '../generated/prisma/client';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { SimulateSalesOrderDto } from './dto/simulate-sales-order.dto';
import { findOrderUnit } from './order-unit';
import { SalesOrdersService } from './sales-orders.service';

// The unit and its partners are read by findOrderUnit (see order-unit.ts)
jest.mock('./order-unit');
// Untyped like the other mocks: the fixtures only contain the fields used
const findUnit = findOrderUnit as unknown as jest.Mock;

const d = (value: string) => new Prisma.Decimal(value);

const GERMANY = {
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};
const POLAND = { ...GERMANY, salesOrganization: '2000' };
const JAPAN = { ...GERMANY, salesOrganization: '3000' };

/** A sales area row as loaded with its organization and currency */
const areaRow = (
  key: typeof GERMANY,
  currency = { code: 'EUR', decimals: 2 },
  isActive = true,
) => ({
  ...key,
  isActive,
  organization: { isActive: true, currency },
});
/** The same sales area as passed to priceItems */
const germany = {
  key: GERMANY,
  isActive: true,
  currency: { code: 'EUR', decimals: 2 },
};

const member = (customerNumber: string) => ({
  customer: {
    customerNumber,
    name: `Customer ${customerNumber}`,
    isActive: true,
  },
});

const unitRecord = {
  unitId: 'UNIT-STUTTGART',
  name: 'Müller – Stuttgart',
  isActive: true,
  soldToCustomerNumber: 'CUST-1000',
  ...GERMANY,
  soldTo: { ...member('CUST-1000'), owner: member('CUST-1000') },
  billTo: member('CUST-1000'),
  payer: member('CUST-1000'),
  shipTos: [
    {
      customerNumber: 'CUST-1100',
      isDefault: true,
      member: member('CUST-1100'),
    },
  ],
};

const priced = (
  materialNumber: string,
  unitPrice: string,
  quantity: number,
  currency = 'EUR',
) => ({
  material: {
    materialNumber,
    description: materialNumber,
    price: null,
    currency: null,
  },
  determination: {
    status: 'PRICED' as const,
    source: 'SALES_AREA' as const,
    condition: { conditionId: 5, validFrom: '1900-01-01', validTo: null },
    unitPrice: d(unitPrice),
    netValue: d(unitPrice).mul(quantity),
    currency,
    conditionType: null,
    steps: [],
  },
});

const unpriced = (materialNumber: string) => ({
  material: {
    materialNumber,
    description: materialNumber,
    price: null,
    currency: null,
  },
  determination: {
    status: 'NO_PRICE_FOUND' as const,
    currency: 'EUR',
    steps: [],
  },
});

const request = {
  ...GERMANY,
  unitId: 'UNIT-STUTTGART',
  pricingDate: '2026-11-15',
  items: [
    { materialNumber: 'MAT-001', quantity: 2 },
    { materialNumber: 'MAT-002', quantity: 10 },
  ],
} satisfies SimulateSalesOrderDto;

describe('SalesOrdersService', () => {
  let service: SalesOrdersService;

  const tx = {
    $executeRaw: jest.fn(),
    salesArea: { findUnique: jest.fn() },
  };
  const prisma = { $transaction: jest.fn() };
  const pricing = { priceItems: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (work: (client: typeof tx) => unknown) => work(tx),
    );
    findUnit.mockResolvedValue(unitRecord);
    tx.salesArea.findUnique.mockResolvedValue(areaRow(GERMANY));
    pricing.priceItems.mockResolvedValue([
      priced('MAT-001', '4400.00', 2),
      priced('MAT-002', '189.50', 10),
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingService, useValue: pricing },
        Clock,
      ],
    }).compile();
    service = module.get(SalesOrdersService);
  });

  it('reads in one read-only REPEATABLE READ transaction', async () => {
    await service.simulate(request);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    // READ ONLY is the first statement of the transaction
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(
      (tx.$executeRaw.mock.calls[0] as [TemplateStringsArray])[0].join(''),
    ).toBe('SET TRANSACTION READ ONLY');
    expect(findUnit).toHaveBeenCalledWith(tx, 'UNIT-STUTTGART');
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findUnit.mock.invocationCallOrder[0],
    );
  });

  it('prices all positions with one batch call inside the transaction', async () => {
    await service.simulate(request);

    expect(pricing.priceItems).toHaveBeenCalledTimes(1);
    expect(pricing.priceItems).toHaveBeenCalledWith(
      {
        unit: unitRecord,
        salesArea: germany,
        pricingDate: '2026-11-15',
        items: request.items,
      },
      tx,
    );
  });

  it('returns a VALID simulation with the exact total', async () => {
    const result = await service.simulate(request);

    expect(result).toMatchObject({
      simulated: true,
      status: 'VALID',
      salesArea: GERMANY,
      currency: 'EUR',
      requestedShippingMethod: 'STANDARD',
      customerReference: null,
      customerNote: null,
      requiresSalesReview: false,
      proposedOrderBlock: null,
      totals: { netValue: '10695.00', currency: 'EUR' },
      messages: [],
    });
    expect(result.items.map((i) => [i.itemNumber, i.netValue])).toEqual([
      [10, '8800.00'],
      [20, '1895.00'],
    ]);
    expect(result.checks[0]).toEqual({ check: 'SALES_AREA', result: 'PASSED' });
  });

  describe('sales area', () => {
    it('never prices a unit of another sales area', async () => {
      tx.salesArea.findUnique.mockResolvedValue(
        areaRow(POLAND, { code: 'PLN', decimals: 2 }),
      );
      pricing.priceItems.mockResolvedValue([
        { material: priced('MAT-001', '1', 1).material, determination: null },
      ]);

      const result = await service.simulate({
        ...request,
        ...POLAND,
        items: [{ materialNumber: 'MAT-001', quantity: 1 }],
      });

      expect(pricing.priceItems).toHaveBeenCalledWith(
        expect.objectContaining({ unit: null, salesArea: null }),
        tx,
      );
      expect(result).toMatchObject({
        status: 'INVALID',
        salesArea: POLAND,
        currency: 'PLN',
        totals: null,
      });
      expect(result.messages[0]).toEqual({
        severity: 'ERROR',
        code: 'UNIT_NOT_IN_SALES_AREA',
        text: 'B2B unit UNIT-STUTTGART belongs to sales area 1000/10/00, not 2000/10/00.',
        field: 'unitId',
      });
      expect(result.items[0]).toMatchObject({
        unitPrice: null,
        pricing: null,
        messages: [],
      });
      expect(result.checks[0]).toEqual({
        check: 'SALES_AREA',
        result: 'FAILED',
      });
    });

    it('reports a sales area that does not exist and prices nothing', async () => {
      tx.salesArea.findUnique.mockResolvedValue(null);
      pricing.priceItems.mockResolvedValue([
        { material: null, determination: null },
        { material: null, determination: null },
      ]);

      const result = await service.simulate({
        ...request,
        distributionChannel: '20',
      });

      expect(result).toMatchObject({ status: 'INVALID', currency: null });
      expect(result.messages[0]).toMatchObject({
        code: 'SALES_AREA_NOT_FOUND',
        text: 'Sales area 1000/20/00 does not exist.',
        field: 'salesOrganization',
      });
      expect(pricing.priceItems).toHaveBeenCalledWith(
        expect.objectContaining({ unit: null, salesArea: null }),
        tx,
      );
    });

    it('reports an inactive sales area and prices nothing', async () => {
      tx.salesArea.findUnique.mockResolvedValue(
        areaRow(GERMANY, undefined, false),
      );
      pricing.priceItems.mockResolvedValue([
        { material: null, determination: null },
        { material: null, determination: null },
      ]);

      const result = await service.simulate(request);

      expect(result.status).toBe('INVALID');
      expect(result.messages.map((m) => m.code)).toEqual([
        'SALES_AREA_INACTIVE',
      ]);
      expect(pricing.priceItems).toHaveBeenCalledWith(
        expect.objectContaining({ unit: null, salesArea: null }),
        tx,
      );
    });

    it('reports a material without price as an item error', async () => {
      pricing.priceItems.mockResolvedValue([
        priced('MAT-001', '4400.00', 2),
        unpriced('MAT-002'),
      ]);

      const result = await service.simulate(request);

      expect(result).toMatchObject({ status: 'INVALID', totals: null });
      expect(result.items[1]).toMatchObject({
        unitPrice: null,
        pricing: null,
        messages: [
          {
            severity: 'ERROR',
            code: 'NO_PRICE_FOUND',
            text: 'No price found for material MAT-002 in sales area 1000/10/00 on 2026-11-15.',
            field: 'materialNumber',
          },
        ],
      });
      expect(
        result.checks.filter((c) => ['MATERIALS', 'PRICING'].includes(c.check)),
      ).toEqual([
        { check: 'MATERIALS', result: 'PASSED' },
        { check: 'PRICING', result: 'FAILED' },
      ]);
    });

    it('totals in JPY without decimal places', async () => {
      const japanUnit = { ...unitRecord, ...JAPAN };
      findUnit.mockResolvedValue(japanUnit);
      tx.salesArea.findUnique.mockResolvedValue(
        areaRow(JAPAN, { code: 'JPY', decimals: 0 }),
      );
      pricing.priceItems.mockResolvedValue([
        priced('MAT-001', '700000', 2, 'JPY'),
        priced('MAT-002', '29500', 10, 'JPY'),
      ]);

      const result = await service.simulate({ ...request, ...JAPAN });

      expect(result).toMatchObject({
        status: 'VALID',
        currency: 'JPY',
        totals: { netValue: '1695000', currency: 'JPY' },
      });
      expect(result.items.map((i) => [i.unitPrice, i.netValue])).toEqual([
        ['700000', '1400000'],
        ['29500', '295000'],
      ]);
    });
  });

  it('turns a note into a warning with a proposed delivery block', async () => {
    const result = await service.simulate({
      ...request,
      customerNote: 'Bitte nur über Tor 3 anliefern.',
      customerReference: 'PO-STR-2026-118',
    });

    expect(result).toMatchObject({
      status: 'VALID_WITH_WARNINGS',
      customerNote: 'Bitte nur über Tor 3 anliefern.',
      customerReference: 'PO-STR-2026-118',
      requiresSalesReview: true,
      proposedOrderBlock: { type: 'DELIVERY_BLOCK', code: 'SALES_REVIEW' },
      totals: { netValue: '10695.00' },
    });
    expect(result.messages.map((m) => m.code)).toEqual([
      'SALES_REVIEW_REQUIRED',
    ]);
  });

  it('treats a whitespace-only note as no note', async () => {
    const result = await service.simulate({
      ...request,
      customerNote: ' \n\t ',
    });

    expect(result).toMatchObject({
      status: 'VALID',
      customerNote: null,
      requiresSalesReview: false,
      proposedOrderBlock: null,
    });
  });

  it('keeps the note warning even if the simulation is invalid', async () => {
    findUnit.mockResolvedValue(null);
    pricing.priceItems.mockResolvedValue([
      { material: null, determination: null },
      { material: null, determination: null },
    ]);

    const result = await service.simulate({
      ...request,
      unitId: 'NOPE',
      customerNote: 'x',
    });

    expect(result.status).toBe('INVALID');
    expect(result.totals).toBeNull();
    expect(result.partners).toBeNull();
    expect(result.requiresSalesReview).toBe(true);
    expect(result.messages.map((m) => m.code)).toEqual([
      'UNIT_NOT_FOUND',
      'SALES_REVIEW_REQUIRED',
    ]);
  });

  it('informs about Express and repeated materials without a warning', async () => {
    pricing.priceItems.mockResolvedValue([
      priced('MAT-002', '189.50', 10),
      priced('MAT-002', '189.50', 5),
    ]);

    const result = await service.simulate({
      ...request,
      requestedShippingMethod: 'EXPRESS' as never,
      items: [
        { materialNumber: 'MAT-002', quantity: 10 },
        { materialNumber: 'MAT-002', quantity: 5 },
      ],
    });

    expect(result.status).toBe('VALID');
    expect(result.messages.map((m) => [m.severity, m.code])).toEqual([
      ['INFO', 'EXPRESS_REQUESTED'],
      ['INFO', 'SAME_MATERIAL_IN_SEVERAL_ITEMS'],
    ]);
    expect(result.totals?.netValue).toBe('2842.50');
  });
});

describe('SalesOrdersService requested delivery date', () => {
  let service: SalesOrdersService;
  const tx = {
    $executeRaw: jest.fn(),
    salesArea: { findUnique: jest.fn() },
  };
  const prisma = { $transaction: jest.fn() };
  const pricing = { priceItems: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (work: (client: typeof tx) => unknown) => work(tx),
    );
    findUnit.mockResolvedValue(unitRecord);
    tx.salesArea.findUnique.mockResolvedValue(areaRow(GERMANY));
    pricing.priceItems.mockResolvedValue([
      priced('MAT-001', '4400.00', 2),
      priced('MAT-002', '189.50', 10),
    ]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingService, useValue: pricing },
        Clock,
      ],
    }).compile();
    service = module.get(SalesOrdersService);
  });

  it('returns null without a requested date', async () => {
    const result = await service.simulate(request);
    expect(result.requestedDeliveryDate).toBeNull();
  });

  it('echoes a later date with an INFO and keeps prices on the order date', async () => {
    const result = await service.simulate({
      ...request,
      requestedDeliveryDate: '2027-01-15',
    });

    expect(result).toMatchObject({
      status: 'VALID',
      pricingDate: '2026-11-15',
      requestedDeliveryDate: '2027-01-15',
      totals: { netValue: '10695.00' },
    });
    expect(result.messages.map((m) => m.code)).toEqual([
      'REQUESTED_DELIVERY_DATE_NOT_CONFIRMED',
    ]);
    // Prices are always determined for the order date
    expect(pricing.priceItems).toHaveBeenCalledWith(
      expect.objectContaining({ pricingDate: '2026-11-15' }),
      tx,
    );
  });

  it('is INVALID without a total for a date before the order date', async () => {
    const result = await service.simulate({
      ...request,
      requestedDeliveryDate: '2026-11-14',
    });

    expect(result.status).toBe('INVALID');
    expect(result.totals).toBeNull();
    expect(result.messages.map((m) => m.code)).toEqual([
      'REQUESTED_DELIVERY_DATE_BEFORE_ORDER_DATE',
    ]);
  });
});

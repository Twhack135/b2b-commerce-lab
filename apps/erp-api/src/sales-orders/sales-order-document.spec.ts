import { Prisma } from '../generated/prisma/client';
import { RequestedShippingMethod } from './dto/simulate-sales-order.dto';
import { OrderEvaluation } from './order-evaluation';
import {
  SalesOrderRecord,
  salesOrderRows,
  toSalesOrder,
} from './sales-order-document';

const d = (value: string) => new Prisma.Decimal(value);
const day = (text: string) => new Date(`${text}T00:00:00.000Z`);
const GERMANY = {
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};

const customer = (customerNumber: string, name: string) => ({
  customerNumber,
  name,
  street: 'Industriestraße 10',
  postalCode: '70173',
  city: 'Stuttgart',
  country: 'DE',
  isActive: true,
});

const conditionType = {
  code: 'ZP03',
  name: 'Special Price',
  conditionClass: 'PRICE' as const,
  calculationType: 'QUANTITY' as const,
};

/** An evaluation like the Stuttgart order: 2 x MAT-001 (ZP03), 1 x MAT-002 (ZP01) */
function evaluation(note: string | null = null): OrderEvaluation {
  const mueller = customer('CUST-1000', 'Müller Heiztechnik GmbH');
  const warehouse = customer('CUST-1100', 'Müller – Lager Stuttgart');
  const priced = (
    conditionId: number,
    scope: 'SOLD_TO' | 'SALES_AREA',
    amount: string,
    quantity: number,
    type = conditionType,
  ) => ({
    status: 'PRICED' as const,
    source: scope,
    condition: {
      conditionId,
      scope,
      salesArea: GERMANY,
      amount: d(amount),
      currency: 'EUR',
      validFrom: '2026-10-29',
      validTo: null,
      isActive: true,
    },
    unitPrice: d(amount),
    netValue: d(amount).times(quantity),
    currency: 'EUR',
    conditionType: type,
    steps: [],
  });
  return {
    simulation: {
      status: note ? 'VALID_WITH_WARNINGS' : 'VALID',
      salesArea: GERMANY,
      requestedDeliveryDate: '2026-11-20',
      requestedShippingMethod: RequestedShippingMethod.EXPRESS,
      customerReference: 'PO-118',
      customerNote: note,
      partners: { shipTo: { customerNumber: 'CUST-1100' } },
      items: [
        { itemNumber: 10, quantity: 2 },
        { itemNumber: 20, quantity: 1 },
      ],
      totals: { netValue: '8999.00', currency: 'EUR' },
      proposedOrderBlock: note ? { code: 'SALES_REVIEW' } : null,
    },
    unit: {
      unitId: 'UNIT-STUTTGART',
      name: 'Müller – Stuttgart',
      soldTo: { customer: mueller },
      billTo: { customer: mueller },
      payer: { customer: mueller },
      shipTos: [
        { customerNumber: 'CUST-1000', member: { customer: mueller } },
        { customerNumber: 'CUST-1100', member: { customer: warehouse } },
      ],
    },
    salesArea: {
      key: GERMANY,
      isActive: true,
      currency: { code: 'EUR', decimals: 2 },
    },
    pricings: [
      {
        material: { materialNumber: 'MAT-001', description: 'Heat Pump' },
        determination: priced(4, 'SOLD_TO', '4400.00', 2),
      },
      {
        material: { materialNumber: 'MAT-002', description: 'Thermostat' },
        determination: priced(6, 'SALES_AREA', '199.00', 1, {
          ...conditionType,
          code: 'ZP01',
          name: 'List Price',
        }),
      },
    ],
  } as unknown as OrderEvaluation;
}

const document = {
  salesOrderNumber: '1000000001',
  requestId: '8f0c6a1e-3b7d-4e7a-9c55-1f2a3b4c5d6e',
  requestHash: 'a'.repeat(64),
  orderDate: '2026-10-30',
  timeZone: 'Europe/Berlin',
};

describe('salesOrderRows', () => {
  it('stores snapshots of unit, partners, materials and the applied conditions', () => {
    const rows = salesOrderRows(evaluation(), document);
    expect(rows.header).toMatchObject({
      salesOrderNumber: '1000000001',
      status: 'OPEN',
      deliveryBlock: null,
      ...GERMANY,
      currency: 'EUR',
      currencyDecimals: 2,
      orderDate: day('2026-10-30'),
      timeZone: 'Europe/Berlin',
      requestedDeliveryDate: day('2026-11-20'),
      requestedShippingMethod: 'EXPRESS',
      customerReference: 'PO-118',
      unitId: 'UNIT-STUTTGART',
      unitName: 'Müller – Stuttgart',
      netValue: '8999.00',
    });
    expect(
      rows.partners.map(
        (p) => `${p.role}:${p.customerNumber}:${p.name}:${p.city}`,
      ),
    ).toEqual([
      'SOLD_TO:CUST-1000:Müller Heiztechnik GmbH:Stuttgart',
      'SHIP_TO:CUST-1100:Müller – Lager Stuttgart:Stuttgart',
      'BILL_TO:CUST-1000:Müller Heiztechnik GmbH:Stuttgart',
      'PAYER:CUST-1000:Müller Heiztechnik GmbH:Stuttgart',
    ]);
    expect(
      rows.items.map((i) => [
        i.itemNumber,
        i.materialNumber,
        i.materialDescription,
        i.quantity,
        (i.unitPrice as Prisma.Decimal).toFixed(2),
        (i.netValue as Prisma.Decimal).toFixed(2),
      ]),
    ).toEqual([
      [10, 'MAT-001', 'Heat Pump', 2, '4400.00', '8800.00'],
      [20, 'MAT-002', 'Thermostat', 1, '199.00', '199.00'],
    ]);
    expect(rows.conditions).toEqual([
      expect.objectContaining({
        itemNumber: 10,
        stepNumber: 10,
        ...GERMANY,
        materialNumber: 'MAT-001',
        conditionId: 4,
        conditionTypeCode: 'ZP03',
        conditionTypeName: 'Special Price',
        scope: 'SOLD_TO',
        validFrom: day('2026-10-29'),
        validTo: null,
      }),
      expect.objectContaining({
        itemNumber: 20,
        stepNumber: 10,
        materialNumber: 'MAT-002',
        conditionId: 6,
        conditionTypeCode: 'ZP01',
        scope: 'SALES_AREA',
      }),
    ]);
  });

  it('sets delivery block SALES_REVIEW for an order with a customer note', () => {
    const rows = salesOrderRows(evaluation('Gate 3'), document);
    expect(rows.header.deliveryBlock).toBe('SALES_REVIEW');
    expect(rows.header.customerNote).toBe('Gate 3');
  });

  it('never stores an order with errors or without prices', () => {
    const invalid = evaluation();
    invalid.simulation.status = 'INVALID';
    expect(() => salesOrderRows(invalid, document)).toThrow(
      'Only a complete order without errors can be stored',
    );

    const unpriced = evaluation();
    unpriced.pricings[1] = {
      ...unpriced.pricings[1],
      determination: { status: 'NO_PRICE_FOUND', currency: 'EUR', steps: [] },
    };
    expect(() => salesOrderRows(unpriced, document)).toThrow(
      'Item 20 has no price',
    );
  });
});

/** A stored order as read with ORDER_INCLUDE */
function record(change: Partial<SalesOrderRecord> = {}): SalesOrderRecord {
  const partner = (role: string, customerNumber: string, name: string) => ({
    salesOrderNumber: '1000000001',
    role,
    customerNumber,
    name,
    street: 'Hafenstraße 25',
    postalCode: '70327',
    city: 'Stuttgart',
    country: 'DE',
  });
  return {
    salesOrderNumber: '1000000001',
    requestId: document.requestId,
    requestHash: document.requestHash,
    status: 'OPEN',
    deliveryBlock: null,
    ...GERMANY,
    currency: 'EUR',
    currencyDecimals: 2,
    orderDate: day('2026-10-30'),
    timeZone: 'Europe/Berlin',
    requestedDeliveryDate: null,
    requestedShippingMethod: 'STANDARD',
    customerReference: null,
    customerNote: null,
    unitId: 'UNIT-STUTTGART',
    unitName: 'Müller – Stuttgart',
    netValue: d('8800'),
    createdAt: new Date('2026-10-30T15:16:22.896Z'),
    updatedAt: new Date('2026-10-30T15:16:22.896Z'),
    // Stored in another order than displayed
    partners: [
      partner('PAYER', 'CUST-1000', 'Müller Heiztechnik GmbH'),
      partner('SHIP_TO', 'CUST-1100', 'Müller – Lager Stuttgart'),
      partner('BILL_TO', 'CUST-1000', 'Müller Heiztechnik GmbH'),
      partner('SOLD_TO', 'CUST-1000', 'Müller Heiztechnik GmbH'),
    ],
    items: [
      {
        salesOrderNumber: '1000000001',
        itemNumber: 10,
        materialNumber: 'MAT-001',
        materialDescription: 'Heat Pump',
        quantity: 2,
        unitPrice: d('4400'),
        netValue: d('8800'),
        conditions: [
          {
            salesOrderNumber: '1000000001',
            itemNumber: 10,
            stepNumber: 10,
            ...GERMANY,
            materialNumber: 'MAT-001',
            conditionId: 4,
            conditionTypeCode: 'ZP03',
            conditionTypeName: 'Special Price',
            scope: 'SOLD_TO',
            amount: d('4400'),
            validFrom: day('2026-10-29'),
            validTo: null,
            conditionValue: d('8800'),
          },
        ],
      },
    ],
    ...change,
  } as SalesOrderRecord;
}

describe('toSalesOrder', () => {
  it('shows the stored order only from its own rows', () => {
    const order = toSalesOrder(record());
    expect(order).toMatchObject({
      salesOrderNumber: '1000000001',
      status: 'OPEN',
      deliveryBlock: null,
      salesArea: GERMANY,
      currency: 'EUR',
      currencyDecimals: 2,
      orderDate: '2026-10-30',
      timeZone: 'Europe/Berlin',
      requestedShippingMethod: 'STANDARD',
      unit: { unitId: 'UNIT-STUTTGART', name: 'Müller – Stuttgart' },
      totals: {
        netValue: '8800.00',
        currency: 'EUR',
        includes: 'NET_EXCL_TAX_AND_FREIGHT',
      },
      createdAt: '2026-10-30T15:16:22.896Z',
    });
    expect(order.partners.soldTo.name).toBe('Müller Heiztechnik GmbH');
    expect(order.partners.shipTo).toEqual({
      customerNumber: 'CUST-1100',
      name: 'Müller – Lager Stuttgart',
      street: 'Hafenstraße 25',
      postalCode: '70327',
      city: 'Stuttgart',
      country: 'DE',
    });
    expect(order.items).toEqual([
      {
        itemNumber: 10,
        materialNumber: 'MAT-001',
        materialDescription: 'Heat Pump',
        quantity: 2,
        unitPrice: '4400.00',
        netValue: '8800.00',
        conditions: [
          {
            stepNumber: 10,
            conditionType: { code: 'ZP03', name: 'Special Price' },
            source: 'SOLD_TO',
            conditionId: 4,
            amount: '4400.00',
            validFrom: '2026-10-29',
            validTo: null,
            value: '8800.00',
          },
        ],
      },
    ]);
  });

  it('formats amounts with the stored decimals of the document currency (JPY)', () => {
    const order = toSalesOrder(
      record({
        salesOrganization: '3000',
        currency: 'JPY',
        currencyDecimals: 0,
        netValue: d('700000'),
      }),
    );
    expect(order.totals).toEqual({
      netValue: '700000',
      currency: 'JPY',
      includes: 'NET_EXCL_TAX_AND_FREIGHT',
    });
    expect(order.items[0].unitPrice).toBe('4400');
  });

  it('fails loudly if a stored partner is missing', () => {
    const broken = record();
    broken.partners = broken.partners.filter((p) => p.role !== 'BILL_TO');
    expect(() => toSalesOrder(broken)).toThrow(
      'Sales order 1000000001 has no partner BILL_TO',
    );
  });
});

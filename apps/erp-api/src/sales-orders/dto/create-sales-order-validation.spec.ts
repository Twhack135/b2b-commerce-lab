import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateSalesOrderDto } from './create-sales-order.dto';

// Same options as the global ValidationPipe in app.setup.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: CreateSalesOrderDto });

const valid = {
  requestId: '8f0c6a1e-3b7d-4e7a-9c55-1f2a3b4c5d6e',
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
  unitId: 'UNIT-STUTTGART',
  items: [
    { materialNumber: 'MAT-001', quantity: 2, expectedUnitPrice: '4400.00' },
    { materialNumber: 'MAT-002', quantity: 10, expectedUnitPrice: '189.50' },
  ],
  expectedTotal: { netValue: '10695.00', currency: 'EUR' },
};

async function messages(body: unknown): Promise<string[]> {
  try {
    await validate(body);
  } catch (error) {
    if (error instanceof BadRequestException) {
      return (error.getResponse() as { message: string[] }).message;
    }
    throw error;
  }
  throw new Error('expected a validation error');
}

describe('CreateSalesOrderDto validation', () => {
  it('accepts the minimal request and all optional fields of the simulation', async () => {
    await expect(validate(valid)).resolves.toBeInstanceOf(CreateSalesOrderDto);
    await expect(
      validate({
        ...valid,
        shipToCustomerNumber: 'CUST-1100',
        requestedDeliveryDate: '2026-11-20',
        requestedShippingMethod: 'EXPRESS',
        customerReference: 'PO-STR-2026-118',
        customerNote: 'Gate 3',
        expectedTotal: { netValue: '700000', currency: 'JPY' },
      }),
    ).resolves.toBeInstanceOf(CreateSalesOrderDto);
  });

  it('requires a UUID as requestId', async () => {
    const { requestId: _omitted, ...withoutId } = valid;
    expect(await messages(withoutId)).toContain('requestId must be a UUID');
    for (const requestId of [
      '',
      'order-1',
      42,
      '8f0c6a1e3b7d4e7a9c551f2a3b4c5d6e-',
    ]) {
      expect(await messages({ ...valid, requestId })).toContain(
        'requestId must be a UUID',
      );
    }
  });

  it('requires the confirmed total', async () => {
    const { expectedTotal: _omitted, ...withoutTotal } = valid;
    expect((await messages(withoutTotal)).join()).toContain('expectedTotal');
  });

  it.each([
    ['-1.00', 'netValue must be a decimal string'],
    ['10695.001', 'netValue must be a decimal string'],
    ['1e4', 'netValue must be a decimal string'],
    ['01.00', 'netValue must be a decimal string'],
    ['1000000000000000000.00', 'netValue must be a decimal string'],
  ])('rejects the total %s', async (netValue, message) => {
    expect(
      (
        await messages({
          ...valid,
          expectedTotal: { netValue, currency: 'EUR' },
        })
      ).join(),
    ).toContain(message);
  });

  it('rejects a numeric total (no floating point)', async () => {
    expect(
      (
        await messages({
          ...valid,
          expectedTotal: { netValue: 10695, currency: 'EUR' },
        })
      ).join(),
    ).toContain('netValue must be a decimal string');
  });

  it.each(['eur', 'EURO', ''])(
    'rejects the currency "%s"',
    async (currency) => {
      expect(
        (
          await messages({
            ...valid,
            expectedTotal: { netValue: '1.00', currency },
          })
        ).join(),
      ).toContain('currency must be a three-letter currency code');
    },
  );

  it.each([
    [
      'a pricing date (the ERP API sets the order date)',
      { pricingDate: '2026-11-15' },
    ],
    ['an order date', { orderDate: '2026-11-15' }],
    ['a currency', { currency: 'EUR' }],
    ['a net value', { netValue: '1.00' }],
    ['a Sold-to', { soldToCustomerNumber: 'CUST-1000' }],
    ['a sales order number', { salesOrderNumber: '1000000001' }],
    ['a status', { status: 'OPEN' }],
  ])('rejects %s', async (_name, extra) => {
    const [field] = Object.keys(extra);
    expect(await messages({ ...valid, ...extra })).toContain(
      `property ${field} should not exist`,
    );
  });

  it.each([
    ['unitPrice', '1.00'],
    ['netValue', '1.00'],
    ['currency', 'EUR'],
    ['conditionId', 1],
  ])('rejects a client price field %s on an item', async (field, value) => {
    const body = {
      ...valid,
      items: [{ ...valid.items[0], [field]: value }],
    };
    expect((await messages(body)).join()).toContain(
      `property ${field} should not exist`,
    );
  });

  it('requires the confirmed unit price of every item', async () => {
    const body = {
      ...valid,
      items: [valid.items[0], { materialNumber: 'MAT-002', quantity: 10 }],
    };
    expect((await messages(body)).join()).toContain(
      'items.1.expectedUnitPrice must be a decimal string',
    );
  });

  it.each([
    ['-1.00'],
    ['189.505'],
    ['1e2'],
    ['01.50'],
    ['10000000000.00'],
    [''],
  ])('rejects the confirmed unit price "%s"', async (expectedUnitPrice) => {
    const body = {
      ...valid,
      items: [{ ...valid.items[0], expectedUnitPrice }],
    };
    expect((await messages(body)).join()).toContain(
      'items.0.expectedUnitPrice must be a decimal string',
    );
  });

  it('rejects a numeric unit price (no floating point)', async () => {
    const body = {
      ...valid,
      items: [{ ...valid.items[0], expectedUnitPrice: 4400 }],
    };
    expect((await messages(body)).join()).toContain(
      'items.0.expectedUnitPrice must be a decimal string',
    );
  });

  it('accepts whole JPY prices and the price 0', async () => {
    const body = {
      ...valid,
      items: [
        { materialNumber: 'MAT-001', quantity: 2, expectedUnitPrice: '700000' },
        { materialNumber: 'MAT-002', quantity: 1, expectedUnitPrice: '0' },
      ],
    };
    await expect(validate(body)).resolves.toBeInstanceOf(CreateSalesOrderDto);
  });

  it('rejects an unknown property of the confirmed total', async () => {
    expect(
      (
        await messages({
          ...valid,
          expectedTotal: {
            netValue: '1.00',
            currency: 'EUR',
            unitPrice: '1.00',
          },
        })
      ).join(),
    ).toContain('property unitPrice should not exist');
  });
});

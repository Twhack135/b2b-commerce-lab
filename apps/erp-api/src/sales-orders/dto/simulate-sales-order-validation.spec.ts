import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SimulateSalesOrderDto } from './simulate-sales-order.dto';

// Same options as the global ValidationPipe in app.setup.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: SimulateSalesOrderDto });

const valid = {
  unitId: 'UNIT-STUTTGART',
  pricingDate: '2026-11-15',
  items: [
    { materialNumber: 'MAT-001', quantity: 2 },
    { materialNumber: 'MAT-002', quantity: 10 },
  ],
};

const items = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    materialNumber: `MAT-${i}`,
    quantity: 1,
  }));

describe('SimulateSalesOrderDto validation', () => {
  it.each([
    ['the minimal request', valid],
    [
      'all optional fields',
      {
        ...valid,
        shipToCustomerNumber: 'CUST-1100',
        requestedShippingMethod: 'EXPRESS',
        customerReference: 'P'.repeat(35),
        customerNote: 'N'.repeat(1000),
      },
    ],
    [
      'explicit nulls for optional fields',
      {
        ...valid,
        shipToCustomerNumber: null,
        requestedShippingMethod: null,
        customerReference: null,
        customerNote: null,
      },
    ],
    ['a whitespace-only note', { ...valid, customerNote: '   ' }],
    [
      'a requested delivery date',
      { ...valid, requestedDeliveryDate: '2026-11-20' },
    ],
    [
      'a null requested delivery date',
      { ...valid, requestedDeliveryDate: null },
    ],
    [
      'the same material twice',
      {
        ...valid,
        items: [
          { materialNumber: 'MAT-002', quantity: 10 },
          { materialNumber: 'MAT-002', quantity: 5 },
        ],
      },
    ],
    ['200 items', { ...valid, items: items(200) }],
    [
      'the largest quantity',
      { ...valid, items: [{ materialNumber: 'MAT-001', quantity: 99999 }] },
    ],
  ])('accepts %s', async (_case, body) => {
    await expect(validate(body)).resolves.toBeDefined();
  });

  it('keeps the items in request order', async () => {
    const dto = (await validate(valid)) as SimulateSalesOrderDto;
    expect(dto.items.map((i) => i.materialNumber)).toEqual([
      'MAT-001',
      'MAT-002',
    ]);
  });

  it.each([
    ['a missing unit', { unitId: undefined }],
    ['a missing pricing date', { pricingDate: undefined }],
    ['an impossible pricing date', { pricingDate: '2026-02-30' }],
    ['no items', { items: [] }],
    ['items as an object', { items: { materialNumber: 'MAT-001' } }],
    ['more than 200 items', { items: items(201) }],
    ['quantity 0', { items: [{ materialNumber: 'MAT-001', quantity: 0 }] }],
    [
      'a fractional quantity',
      { items: [{ materialNumber: 'MAT-001', quantity: 1.5 }] },
    ],
    [
      'a quantity as text',
      { items: [{ materialNumber: 'MAT-001', quantity: '2' }] },
    ],
    [
      'a quantity above 99999',
      { items: [{ materialNumber: 'MAT-001', quantity: 100000 }] },
    ],
    [
      'a blank material number',
      { items: [{ materialNumber: '  ', quantity: 1 }] },
    ],
    [
      'an unknown item property',
      { items: [{ materialNumber: 'MAT-001', quantity: 1, price: '1.00' }] },
    ],
    ['an unknown shipping method', { requestedShippingMethod: 'OVERNIGHT' }],
    [
      'a customer reference longer than 35',
      { customerReference: 'P'.repeat(36) },
    ],
    ['a note longer than 1000', { customerNote: 'N'.repeat(1001) }],
    ['a note as number', { customerNote: 42 }],
    ['a Ship-to with spaces', { shipToCustomerNumber: ' CUST-1100' }],
    ['a Sold-to in the request', { soldToCustomerNumber: 'CUST-1000' }],
    ['a Bill-to in the request', { billToCustomerNumber: 'CUST-1000' }],
    ['a Payer in the request', { payerCustomerNumber: 'CUST-1000' }],
    [
      'an impossible requested delivery date',
      { requestedDeliveryDate: '2026-02-30' },
    ],
    [
      'a German requested delivery date',
      { requestedDeliveryDate: '20.11.2026' },
    ],
    [
      'a requested delivery timestamp',
      { requestedDeliveryDate: '2026-11-20T08:00:00Z' },
    ],
    [
      'a requested delivery date as number',
      { requestedDeliveryDate: 20261120 },
    ],
  ])('rejects %s', async (_case, change) => {
    await expect(validate({ ...valid, ...change })).rejects.toThrow(
      BadRequestException,
    );
  });
});

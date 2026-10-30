import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { RequestedShippingMethod } from './dto/simulate-sales-order.dto';
import { canonicalOrderRequest, hashOrderRequest } from './request-hash';

/** The DTO fields as a plain object, like the parsed JSON body */
type OrderRequest = {
  [K in keyof CreateSalesOrderDto]: CreateSalesOrderDto[K];
};

const request = (): OrderRequest => ({
  requestId: '8f0c6a1e-3b7d-4e7a-9c55-1f2a3b4c5d6e',
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
  unitId: 'UNIT-STUTTGART',
  shipToCustomerNumber: 'CUST-1100',
  requestedDeliveryDate: '2026-11-20',
  requestedShippingMethod: RequestedShippingMethod.STANDARD,
  customerReference: 'PO-STR-2026-118',
  customerNote: null,
  items: [
    { materialNumber: 'MAT-001', quantity: 2, expectedUnitPrice: '4400.00' },
    { materialNumber: 'MAT-002', quantity: 10, expectedUnitPrice: '189.50' },
  ],
  expectedTotal: { netValue: '10695.00', currency: 'EUR' },
});

describe('hashOrderRequest', () => {
  it('is a deterministic SHA-256 hex digest', () => {
    expect(hashOrderRequest(request())).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOrderRequest(request())).toBe(hashOrderRequest(request()));
  });

  it('does not depend on the request ID or the property order of the JSON', () => {
    const { items, expectedTotal, ...header } = request();
    const reordered = {
      expectedTotal,
      items,
      ...header,
      requestId: '00000000-0000-4000-8000-000000000000',
    } as OrderRequest;
    expect(hashOrderRequest(reordered)).toBe(hashOrderRequest(request()));
  });

  it('treats equal values as equal', () => {
    const base = hashOrderRequest({
      ...request(),
      requestedShippingMethod: undefined,
      customerNote: undefined,
      shipToCustomerNumber: undefined,
    });
    // Defaults and empty texts
    expect(
      hashOrderRequest({
        ...request(),
        requestedShippingMethod: RequestedShippingMethod.STANDARD,
        customerNote: '   ',
        shipToCustomerNumber: null,
      }),
    ).toBe(base);
    // The same prices written differently
    expect(
      hashOrderRequest({
        ...request(),
        items: [
          { materialNumber: 'MAT-001', quantity: 2, expectedUnitPrice: '4400' },
          {
            materialNumber: 'MAT-002',
            quantity: 10,
            expectedUnitPrice: '189.5',
          },
        ],
      }),
    ).toBe(hashOrderRequest(request()));
    // The same total written differently
    for (const netValue of ['10695', '10695.0', '10695.00']) {
      expect(
        hashOrderRequest({
          ...request(),
          expectedTotal: { netValue, currency: 'EUR' },
        }),
      ).toBe(hashOrderRequest(request()));
    }
  });

  it.each<[string, Partial<OrderRequest>]>([
    ['sales organization', { salesOrganization: '3000' }],
    ['distribution channel', { distributionChannel: '20' }],
    ['division', { division: '01' }],
    ['unit', { unitId: 'UNIT-MUENCHEN' }],
    ['Ship-to', { shipToCustomerNumber: 'CUST-1200' }],
    ['requested delivery date', { requestedDeliveryDate: '2026-11-21' }],
    ['no requested delivery date', { requestedDeliveryDate: null }],
    [
      'shipping method',
      { requestedShippingMethod: RequestedShippingMethod.EXPRESS },
    ],
    ['customer reference', { customerReference: 'PO-OTHER' }],
    ['customer note', { customerNote: 'Gate 3' }],
    [
      'quantity',
      {
        items: [
          {
            materialNumber: 'MAT-001',
            quantity: 3,
            expectedUnitPrice: '4400.00',
          },
          {
            materialNumber: 'MAT-002',
            quantity: 10,
            expectedUnitPrice: '189.50',
          },
        ],
      },
    ],
    [
      'material',
      {
        items: [
          {
            materialNumber: 'MAT-101',
            quantity: 2,
            expectedUnitPrice: '11.11',
          },
          {
            materialNumber: 'MAT-002',
            quantity: 10,
            expectedUnitPrice: '189.50',
          },
        ],
      },
    ],
    [
      'item order',
      {
        items: [
          {
            materialNumber: 'MAT-002',
            quantity: 10,
            expectedUnitPrice: '189.50',
          },
          {
            materialNumber: 'MAT-001',
            quantity: 2,
            expectedUnitPrice: '4400.00',
          },
        ],
      },
    ],
    [
      'an additional item',
      {
        items: [
          ...request().items,
          {
            materialNumber: 'MAT-101',
            quantity: 1,
            expectedUnitPrice: '11.11',
          },
        ],
      },
    ],
    [
      'confirmed price of an item',
      {
        items: [
          {
            materialNumber: 'MAT-001',
            quantity: 2,
            expectedUnitPrice: '4400.01',
          },
          {
            materialNumber: 'MAT-002',
            quantity: 10,
            expectedUnitPrice: '189.50',
          },
        ],
      },
    ],
    [
      'confirmed total',
      { expectedTotal: { netValue: '10695.01', currency: 'EUR' } },
    ],
    [
      'confirmed currency',
      { expectedTotal: { netValue: '10695.00', currency: 'PLN' } },
    ],
  ])('changes with the %s', (_field, change) => {
    expect(hashOrderRequest({ ...request(), ...change })).not.toBe(
      hashOrderRequest(request()),
    );
  });

  it('cannot confuse field boundaries', () => {
    // JSON arrays keep "A","B" and "A,B" apart
    expect(
      canonicalOrderRequest({
        ...request(),
        customerReference: 'A',
        customerNote: 'B',
      }),
    ).not.toBe(
      canonicalOrderRequest({
        ...request(),
        customerReference: 'A","B',
        customerNote: null,
      }),
    );
  });
});

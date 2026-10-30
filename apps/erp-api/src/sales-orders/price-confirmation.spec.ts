import { priceChangeMessages, priceChanges } from './price-confirmation';
import { SalesOrderSimulation } from './sales-order-simulation.interface';

/** The current evaluation: positions with their prices and the total */
const evaluation = (
  items: [materialNumber: string, quantity: number, unitPrice: string | null][],
  total: string | null,
  currency = 'EUR',
) =>
  ({
    currency,
    items: items.map(([materialNumber, quantity, unitPrice], index) => ({
      itemNumber: (index + 1) * 10,
      materialNumber,
      quantity,
      unitPrice,
    })),
    totals: total === null ? null : { netValue: total, currency },
  }) as unknown as SalesOrderSimulation;

/** The confirmed prices of the request, position by position */
const confirmed = (
  items: [
    materialNumber: string,
    quantity: number,
    expectedUnitPrice: string,
  ][],
  netValue: string,
  currency = 'EUR',
) => ({
  items: items.map(([materialNumber, quantity, expectedUnitPrice]) => ({
    materialNumber,
    quantity,
    expectedUnitPrice,
  })),
  expectedTotal: { netValue, currency },
});

const stuttgart = (mat1: string, mat2: string, total: string) =>
  evaluation(
    [
      ['MAT-001', 2, mat1],
      ['MAT-002', 10, mat2],
    ],
    total,
  );
const confirmedStuttgart = confirmed(
  [
    ['MAT-001', 2, '4400.00'],
    ['MAT-002', 10, '189.50'],
  ],
  '10695.00',
);

describe('priceChanges', () => {
  it('finds no change when every price and the total are the same', () => {
    expect(
      priceChanges(
        stuttgart('4400.00', '189.50', '10695.00'),
        confirmedStuttgart,
      ),
    ).toEqual({ items: [], total: false });
  });

  it('catches changes in opposite directions that keep the total', () => {
    // +5.00 x 2 = +10.00 and -1.00 x 10 = -10.00
    const changes = priceChanges(
      stuttgart('4405.00', '188.50', '10695.00'),
      confirmedStuttgart,
    );
    expect(changes).toEqual({
      items: [
        {
          itemNumber: 10,
          materialNumber: 'MAT-001',
          quantity: 2,
          expectedUnitPrice: '4400.00',
          unitPrice: '4405.00',
        },
        {
          itemNumber: 20,
          materialNumber: 'MAT-002',
          quantity: 10,
          expectedUnitPrice: '189.50',
          unitPrice: '188.50',
        },
      ],
      total: false,
    });
  });

  it('catches a changed total', () => {
    expect(
      priceChanges(
        stuttgart('4400.00', '190.00', '10700.00'),
        confirmedStuttgart,
      ),
    ).toMatchObject({ items: [{ itemNumber: 20 }], total: true });
  });

  it('compares every position of the same material separately', () => {
    const current = evaluation(
      [
        ['MAT-002', 1, '189.50'],
        ['MAT-002', 1, '179.00'],
      ],
      '368.50',
    );
    // Correct prices in the order of the positions
    expect(
      priceChanges(
        current,
        confirmed(
          [
            ['MAT-002', 1, '189.50'],
            ['MAT-002', 1, '179.00'],
          ],
          '368.50',
        ),
      ),
    ).toEqual({ items: [], total: false });
    // The same prices, swapped between the positions: same total, both differ
    const swapped = confirmed(
      [
        ['MAT-002', 1, '179.00'],
        ['MAT-002', 1, '189.50'],
      ],
      '368.50',
    );
    expect(priceChanges(current, swapped)).toMatchObject({
      items: [{ itemNumber: 10 }, { itemNumber: 20 }],
      total: false,
    });
  });

  it('compares reordered positions with their own confirmed prices', () => {
    const reordered = evaluation(
      [
        ['MAT-002', 10, '189.50'],
        ['MAT-001', 2, '4400.00'],
      ],
      '10695.00',
    );
    // Prices travel with their positions: no change
    expect(
      priceChanges(
        reordered,
        confirmed(
          [
            ['MAT-002', 10, '189.50'],
            ['MAT-001', 2, '4400.00'],
          ],
          '10695.00',
        ),
      ),
    ).toEqual({ items: [], total: false });
    // Positions reordered, prices left in the old order: both differ
    expect(
      priceChanges(reordered, confirmedStuttgart).items.map(
        (i) => i.itemNumber,
      ),
    ).toEqual([10, 20]);
  });

  it('compares exactly as decimals, independent of the notation', () => {
    expect(
      priceChanges(
        evaluation([['MAT-001', 2, '700000']], '1400000', 'JPY'),
        confirmed([['MAT-001', 2, '700000.00']], '1400000.0', 'JPY'),
      ),
    ).toEqual({ items: [], total: false });
    // One cent is a change; no floating point rounding hides it
    expect(
      priceChanges(
        evaluation([['MAT-101', 3, '0.30']], '0.90'),
        confirmed([['MAT-101', 3, '0.31']], '0.90'),
      ).items,
    ).toHaveLength(1);
  });

  it('reports a position without a current price and a different currency', () => {
    const changes = priceChanges(
      evaluation([['MAT-001', 2, null]], null),
      confirmed([['MAT-001', 2, '4400.00']], '8800.00'),
    );
    expect(changes).toEqual({
      items: [
        {
          itemNumber: 10,
          materialNumber: 'MAT-001',
          quantity: 2,
          expectedUnitPrice: '4400.00',
          unitPrice: null,
        },
      ],
      total: true,
    });
    expect(
      priceChanges(
        evaluation([['MAT-001', 2, '4400.00']], '8800.00'),
        confirmed([['MAT-001', 2, '4400.00']], '8800.00', 'PLN'),
      ),
    ).toEqual({ items: [], total: true });
  });
});

describe('priceChangeMessages', () => {
  it('names every changed position and the total', () => {
    const current = stuttgart('4405.00', '190.00', '10710.00');
    expect(
      priceChangeMessages(
        priceChanges(current, confirmedStuttgart),
        current,
        confirmedStuttgart,
      ),
    ).toEqual([
      'The price of item 10 (MAT-001) is now 4405.00 EUR instead of the confirmed 4400.00 EUR.',
      'The price of item 20 (MAT-002) is now 190.00 EUR instead of the confirmed 189.50 EUR.',
      'The order total is now 10710.00 EUR instead of the confirmed 10695.00 EUR.',
      'Nothing was stored; review the new prices and confirm the order again.',
    ]);
  });
});

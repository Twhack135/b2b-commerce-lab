import { ConditionTypesService } from './condition-types.service';

describe('ConditionTypesService', () => {
  const db = { conditionType: { findMany: jest.fn() } };
  const service = new ConditionTypesService(db as never);

  const row = (
    code: string,
    conditionClass: string,
    calculationType: string,
    { isActive = true, allowed = true, sortOrder = 10 } = {},
  ) => ({
    code,
    name: `Type ${code}`,
    conditionClass,
    calculationType,
    isActive,
    allowedForConditionRecords: allowed,
    sortOrder,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => jest.resetAllMocks());

  it('lists all types in display order and tells which can be used and why not', async () => {
    db.conditionType.findMany.mockResolvedValue([
      row('ZP01', 'PRICE', 'QUANTITY', { allowed: false, sortOrder: 10 }),
      row('ZP02', 'PRICE', 'QUANTITY', { sortOrder: 20 }),
      row('ZD01', 'DISCOUNT_SURCHARGE', 'PERCENTAGE', {
        allowed: false,
        sortOrder: 40,
      }),
      row('ZPX1', 'PRICE', 'QUANTITY', { isActive: false, sortOrder: 90 }),
    ]);

    const types = await service.findAll();

    expect(db.conditionType.findMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    expect(
      types.map((t) => [
        t.code,
        t.allowedForConditionRecords,
        t.usableForPriceConditions,
        t.restriction,
      ]),
    ).toEqual([
      ['ZP01', false, false, 'NOT_ALLOWED_FOR_CONDITION_RECORDS'],
      ['ZP02', true, true, null],
      ['ZD01', false, false, 'CALCULATION_NOT_SUPPORTED'],
      ['ZPX1', true, false, 'INACTIVE'],
    ]);
    expect(types[1]).toEqual({
      code: 'ZP02',
      name: 'Type ZP02',
      conditionClass: 'PRICE',
      calculationType: 'QUANTITY',
      isActive: true,
      sortOrder: 20,
      allowedForConditionRecords: true,
      usableForPriceConditions: true,
      restriction: null,
    });
  });
});

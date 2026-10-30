import { ConditionTypesService } from './condition-types.service';

describe('ConditionTypesService', () => {
  const db = { conditionType: { findMany: jest.fn() } };
  const service = new ConditionTypesService(db as never);

  const row = (
    code: string,
    conditionClass: string,
    calculationType: string,
    {
      isActive = true,
      allowed = true,
      sortOrder = 10,
      scopes = [] as string[],
    } = {},
  ) => ({
    code,
    name: `Type ${code}`,
    conditionClass,
    calculationType,
    isActive,
    allowedForConditionRecords: allowed,
    sortOrder,
    // Stored in any order; returned in the order of the access sequence
    allowedScopes: scopes.map((scope) => ({ conditionTypeCode: code, scope })),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => jest.resetAllMocks());

  it('lists all types in display order and tells which can be used and why not', async () => {
    db.conditionType.findMany.mockResolvedValue([
      row('ZP01', 'PRICE', 'QUANTITY', {
        sortOrder: 10,
        scopes: ['SALES_AREA'],
      }),
      row('ZP02', 'PRICE', 'QUANTITY', {
        sortOrder: 20,
        scopes: ['SOLD_TO', 'B2B_UNIT'],
      }),
      row('ZD01', 'DISCOUNT_SURCHARGE', 'PERCENTAGE', {
        allowed: false,
        sortOrder: 40,
      }),
      row('ZPX1', 'PRICE', 'QUANTITY', { isActive: false, sortOrder: 90 }),
    ]);

    const types = await service.findAll();

    expect(db.conditionType.findMany).toHaveBeenCalledWith({
      include: { allowedScopes: true },
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
      ['ZP01', true, true, null],
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
      allowedScopes: ['B2B_UNIT', 'SOLD_TO'],
    });
    expect(types[0].allowedScopes).toEqual(['SALES_AREA']);
    expect(types[2].allowedScopes).toEqual([]);
  });
});

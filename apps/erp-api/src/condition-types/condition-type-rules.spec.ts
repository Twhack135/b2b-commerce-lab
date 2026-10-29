import {
  conditionRecordRestriction,
  conditionTypeViolations,
  isSupportedForPriceConditions,
  LIST_PRICE_CONDITION_TYPE,
  toConditionTypeSummary,
} from './condition-type-rules';

const type = (
  conditionClass: 'PRICE' | 'DISCOUNT_SURCHARGE' | 'FREIGHT' | 'TAX',
  calculationType: 'QUANTITY' | 'FIXED_AMOUNT' | 'PERCENTAGE',
  { isActive = true, allowedForConditionRecords = true } = {},
) => ({
  name: 'Test',
  conditionClass,
  calculationType,
  isActive,
  allowedForConditionRecords,
});

describe('condition type rules', () => {
  it('supports only prices per unit for price conditions', () => {
    expect(isSupportedForPriceConditions(type('PRICE', 'QUANTITY'))).toBe(true);
    for (const [conditionClass, calculationType] of [
      ['PRICE', 'FIXED_AMOUNT'],
      ['PRICE', 'PERCENTAGE'],
      ['DISCOUNT_SURCHARGE', 'PERCENTAGE'],
      ['DISCOUNT_SURCHARGE', 'QUANTITY'],
      ['FREIGHT', 'FIXED_AMOUNT'],
      ['TAX', 'PERCENTAGE'],
    ] as const) {
      expect(
        isSupportedForPriceConditions(type(conditionClass, calculationType)),
      ).toBe(false);
    }
  });

  describe('conditionRecordRestriction', () => {
    it('allows an active, supported and allowed type', () => {
      expect(conditionRecordRestriction(type('PRICE', 'QUANTITY'))).toBeNull();
    });

    it('checks active, then calculation, then the configuration', () => {
      expect(
        conditionRecordRestriction(
          type('TAX', 'PERCENTAGE', {
            isActive: false,
            allowedForConditionRecords: false,
          }),
        ),
      ).toBe('INACTIVE');
      expect(
        conditionRecordRestriction(
          type('TAX', 'PERCENTAGE', { allowedForConditionRecords: false }),
        ),
      ).toBe('CALCULATION_NOT_SUPPORTED');
      expect(
        conditionRecordRestriction(
          type('PRICE', 'QUANTITY', { allowedForConditionRecords: false }),
        ),
      ).toBe('NOT_ALLOWED_FOR_CONDITION_RECORDS');
    });

    it('never allows an unsupported calculation, even if configured', () => {
      expect(conditionRecordRestriction(type('FREIGHT', 'FIXED_AMOUNT'))).toBe(
        'CALCULATION_NOT_SUPPORTED',
      );
    });
  });

  it('accepts an active, supported and allowed condition type', () => {
    expect(conditionTypeViolations('ZP02', type('PRICE', 'QUANTITY'))).toEqual(
      [],
    );
  });

  it('rejects an unknown, inactive, unsupported or not allowed condition type', () => {
    expect(conditionTypeViolations('ZZ99', null)).toEqual([
      'conditionTypeCode ZZ99 does not exist',
    ]);
    expect(
      conditionTypeViolations(
        'ZP09',
        type('PRICE', 'QUANTITY', { isActive: false }),
      ),
    ).toEqual(['conditionTypeCode ZP09 (Test) is inactive']);
    expect(
      conditionTypeViolations('ZP08', type('PRICE', 'FIXED_AMOUNT')),
    ).toEqual([
      'conditionTypeCode ZP08 (Test) cannot be used for price conditions yet: only condition types of class PRICE with calculation type QUANTITY are supported, not PRICE with FIXED_AMOUNT',
    ]);
    expect(
      conditionTypeViolations(
        'ZP01',
        type('PRICE', 'QUANTITY', { allowedForConditionRecords: false }),
      ),
    ).toEqual([
      'conditionTypeCode ZP01 (Test) is not allowed for condition records by its configuration',
    ]);
  });

  it('summarizes a condition type without internal fields', () => {
    expect(
      toConditionTypeSummary({
        code: 'ZP02',
        name: 'Customer Net Price',
        conditionClass: 'PRICE',
        calculationType: 'QUANTITY',
        isActive: true,
        sortOrder: 20,
      } as never),
    ).toEqual({
      code: 'ZP02',
      name: 'Customer Net Price',
      conditionClass: 'PRICE',
      calculationType: 'QUANTITY',
    });
  });

  it('uses ZP01 as the transitional list price type', () => {
    expect(LIST_PRICE_CONDITION_TYPE).toBe('ZP01');
  });
});

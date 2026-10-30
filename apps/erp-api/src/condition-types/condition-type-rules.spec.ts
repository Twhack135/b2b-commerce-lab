import {
  conditionRecordRestriction,
  conditionTypeViolations,
  isSupportedForPriceConditions,
  scopeViolations,
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

  describe('scopeViolations (configured scopes per condition type)', () => {
    const zp01 = {
      name: 'List Price',
      allowedScopes: [{ scope: 'SALES_AREA' as const }],
    };
    const zp02 = {
      name: 'Customer Net Price',
      allowedScopes: [
        { scope: 'SOLD_TO' as const },
        { scope: 'B2B_UNIT' as const },
      ],
    };

    it('allows a configured scope', () => {
      expect(scopeViolations('ZP01', zp01, 'SALES_AREA')).toEqual([]);
      expect(scopeViolations('ZP02', zp02, 'B2B_UNIT')).toEqual([]);
    });

    it('rejects a scope that is not configured and names the allowed ones', () => {
      expect(scopeViolations('ZP01', zp01, 'SOLD_TO')).toEqual([
        'conditionTypeCode ZP01 (List Price) cannot be used with scope SOLD_TO; allowed scopes: SALES_AREA',
      ]);
      expect(scopeViolations('ZP02', zp02, 'SALES_AREA')).toEqual([
        'conditionTypeCode ZP02 (Customer Net Price) cannot be used with scope SALES_AREA; allowed scopes: SOLD_TO, B2B_UNIT',
      ]);
    });

    it('rejects every scope of a type without configured scopes', () => {
      expect(
        scopeViolations(
          'ZT01',
          { name: 'Tax', allowedScopes: [] },
          'SALES_AREA',
        ),
      ).toEqual([
        'conditionTypeCode ZT01 (Tax) cannot be used with scope SALES_AREA: no scope is configured for it',
      ]);
    });
  });
});

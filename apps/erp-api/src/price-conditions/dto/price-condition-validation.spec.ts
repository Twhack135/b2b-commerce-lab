import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CalculatePriceDto } from '../../pricing/dto/calculate-price.dto';
import { CreatePriceConditionDto } from './create-price-condition.dto';
import { UpdatePriceConditionDto } from './update-price-condition.dto';

// Same options as the global ValidationPipe in app.setup.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

type Dto =
  | typeof CreatePriceConditionDto
  | typeof UpdatePriceConditionDto
  | typeof CalculatePriceDto;

function validate(body: unknown, dto: Dto) {
  return pipe.transform(body, { type: 'body', metatype: dto });
}

/** The validation messages, or [] if the body is valid */
async function messagesOf(body: unknown, dto: Dto): Promise<string[]> {
  try {
    await validate(body, dto);
    return [];
  } catch (error) {
    const response = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return response.message;
  }
}

const GERMANY = {
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
};

const soldToBody = {
  conditionTypeCode: 'ZP02',
  ...GERMANY,
  materialNumber: 'MAT-001',
  scope: 'SOLD_TO',
  soldToCustomerNumber: 'CUST-1000',
  amount: '4200.50',
  currency: 'EUR',
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
};

const unitBody = {
  conditionTypeCode: 'ZP02',
  ...GERMANY,
  materialNumber: 'MAT-001',
  scope: 'B2B_UNIT',
  unitId: 'UNIT-STUTTGART',
  amount: '4100.00',
  currency: 'EUR',
  validFrom: '2026-01-01',
};

describe('CreatePriceConditionDto validation', () => {
  it.each([
    ['a Sold-to condition', soldToBody],
    ['a unit condition without end', unitBody],
    ['an explicit open end', { ...unitBody, validTo: null }],
    ['an inactive condition', { ...soldToBody, isActive: false }],
    ['the smallest amount', { ...soldToBody, amount: '0.01' }],
    ['the largest amount', { ...soldToBody, amount: '9999999999.99' }],
    ['an amount without decimals', { ...soldToBody, amount: '42' }],
    ['an amount with one decimal', { ...soldToBody, amount: '42.5' }],
    ['a one-day period', { ...soldToBody, validTo: '2026-01-01' }],
    // Sprint 9C-B
    [
      'a list price of the sales area without key and currency',
      {
        conditionTypeCode: 'ZP01',
        ...GERMANY,
        materialNumber: 'MAT-001',
        scope: 'SALES_AREA',
        amount: '4500.00',
        validFrom: '1900-01-01',
      },
    ],
    [
      'a JPY amount without decimals',
      {
        ...soldToBody,
        salesOrganization: '3000',
        currency: 'JPY',
        amount: '700000',
      },
    ],
    [
      'no currency (taken from the sales area)',
      { ...soldToBody, currency: undefined },
    ],
  ])('should accept %s', async (_case, body) => {
    await expect(messagesOf(body, CreatePriceConditionDto)).resolves.toEqual(
      [],
    );
  });

  it('should keep the amount as exact text', async () => {
    await expect(
      validate(soldToBody, CreatePriceConditionDto),
    ).resolves.toMatchObject({ amount: '4200.50' });
  });

  it.each([
    [
      'a missing condition type',
      { conditionTypeCode: undefined },
      'conditionTypeCode must be a condition type code',
    ],
    [
      'a lowercase condition type',
      { conditionTypeCode: 'zp02' },
      'conditionTypeCode must be a condition type code',
    ],
    [
      'a condition type with 5 characters',
      { conditionTypeCode: 'ZP021' },
      'conditionTypeCode must be a condition type code',
    ],
    [
      'a condition type as number',
      { conditionTypeCode: 2 },
      'conditionTypeCode must be a string',
    ],
    ['a missing scope', { scope: undefined }, 'scope must be one of'],
    [
      'a missing sales organization',
      { salesOrganization: undefined },
      'salesOrganization must be 4 capital letters or digits',
    ],
    [
      'a sales organization as number',
      { salesOrganization: 1000 },
      'salesOrganization must be a string',
    ],
    [
      'a missing distribution channel',
      { distributionChannel: undefined },
      'distributionChannel must be 2 capital letters or digits',
    ],
    ['a division with 3 characters', { division: '000' }, 'division must be 2'],
    [
      'a list price with a Sold-to',
      { scope: 'SALES_AREA' },
      'soldToCustomerNumber is only allowed when scope is SOLD_TO',
    ],
    [
      'a sales area as one field',
      { salesArea: '1000/10/00' },
      'property salesArea',
    ],
    ['an unknown scope', { scope: 'CUSTOMER' }, 'scope must be one of'],
    [
      'a Sold-to condition without customer',
      { soldToCustomerNumber: undefined },
      'soldToCustomerNumber must be a string',
    ],
    [
      'a Sold-to condition with a unit',
      { unitId: 'UNIT-STUTTGART' },
      'unitId is only allowed when scope is B2B_UNIT',
    ],
    [
      'a customer number with spaces',
      { soldToCustomerNumber: ' CUST-1000' },
      'soldToCustomerNumber must not be blank',
    ],
    [
      'a customer number longer than 20',
      { soldToCustomerNumber: 'C'.repeat(21) },
      'soldToCustomerNumber must be shorter than or equal to 20 characters',
    ],
    ['a missing material', { materialNumber: undefined }, 'materialNumber'],
    ['an amount as number', { amount: 4200.5 }, 'amount must be a string'],
    ['an amount of zero', { amount: '0.00' }, 'amount must be greater than 0'],
    ['a negative amount', { amount: '-1.00' }, 'amount must be a decimal'],
    ['three decimals', { amount: '1.999' }, 'amount must be a decimal'],
    ['a decimal comma', { amount: '4200,50' }, 'amount must be a decimal'],
    ['a leading zero', { amount: '042.00' }, 'amount must be a decimal'],
    ['11 digits', { amount: '10000000000.00' }, 'amount must be a decimal'],
    ['an exponent', { amount: '1e3' }, 'amount must be a decimal'],
    ['a blank amount', { amount: ' ' }, 'amount must be a decimal'],
    ['a lowercase currency', { currency: 'eur' }, 'currency must be exactly'],
    ['a missing validFrom', { validFrom: undefined }, 'validFrom must be'],
    ['an impossible date', { validFrom: '2026-02-30' }, 'validFrom must be'],
    ['a timestamp', { validTo: '2026-12-31T23:59:59Z' }, 'validTo must be'],
    ['isActive as text', { isActive: 'true' }, 'isActive must be a boolean'],
    ['an unknown property', { discount: '5' }, 'property discount'],
  ])('should reject %s', async (_case, change, expected) => {
    const messages = await messagesOf(
      { ...soldToBody, ...change },
      CreatePriceConditionDto,
    );
    expect(messages.join(' | ')).toContain(expected);
  });

  it.each([
    [
      'a unit condition without unit',
      { unitId: undefined },
      'unitId must be a string',
    ],
    [
      'a unit condition with a Sold-to',
      { soldToCustomerNumber: 'CUST-1000' },
      'soldToCustomerNumber is only allowed when scope is SOLD_TO',
    ],
    [
      'a unit ID longer than 20',
      { unitId: 'U'.repeat(21) },
      'unitId must be shorter than or equal to 20 characters',
    ],
  ])('should reject %s', async (_case, change, expected) => {
    const messages = await messagesOf(
      { ...unitBody, ...change },
      CreatePriceConditionDto,
    );
    expect(messages.join(' | ')).toContain(expected);
  });
});

describe('UpdatePriceConditionDto validation', () => {
  it.each([
    [{ amount: '99.90' }],
    [{ validFrom: '2026-02-01', validTo: '2026-02-28' }],
    [{ validTo: null }],
    [{ isActive: false }],
    [{}],
  ])('should accept %p', async (body) => {
    await expect(messagesOf(body, UpdatePriceConditionDto)).resolves.toEqual(
      [],
    );
  });

  it('should keep an explicit null for validTo', async () => {
    await expect(
      validate({ validTo: null }, UpdatePriceConditionDto),
    ).resolves.toMatchObject({ validTo: null });
  });

  it.each([
    ['changing the material', { materialNumber: 'MAT-002' }],
    ['changing the scope', { scope: 'B2B_UNIT' }],
    ['changing the Sold-to', { soldToCustomerNumber: 'CUST-1100' }],
    ['changing the unit', { unitId: 'UNIT-MUENCHEN' }],
    ['changing the currency', { currency: 'USD' }],
    ['changing the condition type', { conditionTypeCode: 'ZP03' }],
    ['changing the sales organization', { salesOrganization: '2000' }],
    ['changing the distribution channel', { distributionChannel: '10' }],
    ['changing the division', { division: '00' }],
    ['a null amount', { amount: null }],
    ['a null validFrom', { validFrom: null }],
    ['an invalid validTo', { validTo: '31.12.2026' }],
    ['isActive as number', { isActive: 1 }],
  ])('should reject %s', async (_case, body) => {
    await expect(validate(body, UpdatePriceConditionDto)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('CalculatePriceDto validation', () => {
  const body = {
    materialNumber: 'MAT-001',
    unitId: 'UNIT-STUTTGART',
    ...GERMANY,
    pricingDate: '2026-11-15',
  };

  it.each([[body], [{ ...body, quantity: 1 }], [{ ...body, quantity: 99999 }]])(
    'should accept %p',
    async (value) => {
      await expect(messagesOf(value, CalculatePriceDto)).resolves.toEqual([]);
    },
  );

  it.each([
    ['a missing pricing date', { pricingDate: undefined }],
    ['an invalid pricing date', { pricingDate: '2026-11-31' }],
    ['a missing unit', { unitId: undefined }],
    ['a missing material', { materialNumber: undefined }],
    ['quantity 0', { quantity: 0 }],
    ['a negative quantity', { quantity: -1 }],
    ['a fractional quantity', { quantity: 1.5 }],
    ['a quantity above 99999', { quantity: 100000 }],
    ['a quantity as text', { quantity: '2' }],
    ['a Sold-to instead of the unit', { soldToCustomerNumber: 'CUST-1000' }],
    ['a missing sales organization', { salesOrganization: undefined }],
    ['a missing distribution channel', { distributionChannel: undefined }],
    ['a missing division', { division: undefined }],
    ['a lower-case sales organization', { salesOrganization: 'de01' }],
    ['a currency chosen by the client', { currency: 'EUR' }],
  ])('should reject %s', async (_case, change) => {
    await expect(
      validate({ ...body, ...change }, CalculatePriceDto),
    ).rejects.toThrow(BadRequestException);
  });
});

import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { COUNTRY_CODES } from '../../common/country-codes';
import { CreateCustomerDto } from './create-customer.dto';
import { UpdateCustomerDto } from './update-customer.dto';

// Same options as the global ValidationPipe in main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function validate(
  body: unknown,
  dto: typeof CreateCustomerDto | typeof UpdateCustomerDto,
) {
  return pipe.transform(body, { type: 'body', metatype: dto });
}

/** Returns the validation messages, or [] if the body is valid */
async function messagesFor(
  body: unknown,
  dto: typeof CreateCustomerDto | typeof UpdateCustomerDto,
): Promise<string[]> {
  try {
    await validate(body, dto);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    const response = error.getResponse() as { message: string[] };
    return response.message;
  }
}

const validCreateBody = {
  customerNumber: 'CUST-0001',
  name: 'Nordwind Heizungsbau GmbH',
  street: 'Hafenstraße 12',
  postalCode: '20457',
  city: 'Hamburg',
  country: 'DE',
};

describe('CreateCustomerDto validation', () => {
  it('should accept a valid customer without isActive', async () => {
    await expect(
      validate(validCreateBody, CreateCustomerDto),
    ).resolves.toMatchObject(validCreateBody);
  });

  it.each([[true], [false]])('should accept isActive %p', async (isActive) => {
    await expect(
      validate({ ...validCreateBody, isActive }, CreateCustomerDto),
    ).resolves.toMatchObject({ isActive });
  });

  it.each([['CUST-0001'], ['10000'], ['K 100'], ['A'], ['X'.repeat(20)]])(
    'should keep the valid customer number %p unchanged',
    async (customerNumber) => {
      await expect(
        validate({ ...validCreateBody, customerNumber }, CreateCustomerDto),
      ).resolves.toMatchObject({ customerNumber });
    },
  );

  it.each([['20457'], ['1070'], ['SW1A 1AA'], ['00-950'], ['K1A0B1']])(
    'should accept postal code %p',
    async (postalCode) => {
      await expect(
        validate({ ...validCreateBody, postalCode }, CreateCustomerDto),
      ).resolves.toMatchObject({ postalCode });
    },
  );

  it.each([['DE'], ['AT'], ['CH'], ['US'], ['GB'], ['AD'], ['ZW']])(
    'should accept country %p',
    async (country) => {
      await expect(
        validate({ ...validCreateBody, country }, CreateCustomerDto),
      ).resolves.toMatchObject({ country });
    },
  );

  it.each([
    ['missing customerNumber', { customerNumber: undefined }],
    ['empty customerNumber', { customerNumber: '' }],
    ['whitespace-only customerNumber', { customerNumber: '   ' }],
    ['customerNumber with leading space', { customerNumber: ' CUST-1' }],
    ['customerNumber with trailing space', { customerNumber: 'CUST-1 ' }],
    ['customerNumber longer than 20', { customerNumber: 'X'.repeat(21) }],
    ['numeric customerNumber', { customerNumber: 1001 }],
    ['missing name', { name: undefined }],
    ['whitespace-only name', { name: '  \t ' }],
    ['name longer than 100', { name: 'N'.repeat(101) }],
    ['missing street', { street: undefined }],
    ['whitespace-only street', { street: '   ' }],
    ['street longer than 100', { street: 'S'.repeat(101) }],
    ['missing postalCode', { postalCode: undefined }],
    ['blank postalCode', { postalCode: '   ' }],
    ['postalCode with leading space', { postalCode: ' 20457' }],
    ['postalCode with trailing hyphen', { postalCode: '20457-' }],
    ['postalCode with special characters', { postalCode: '20457#' }],
    ['postalCode longer than 10', { postalCode: '12345678901' }],
    ['numeric postalCode', { postalCode: 20457 }],
    ['missing city', { city: undefined }],
    ['whitespace-only city', { city: '   ' }],
    ['city longer than 60', { city: 'C'.repeat(61) }],
    ['missing country', { country: undefined }],
    ['lowercase country', { country: 'de' }],
    ['three-letter country', { country: 'DEU' }],
    ['unassigned country code', { country: 'XX' }],
    ['user-assigned code XK (Kosovo)', { country: 'XK' }],
    ['reserved code UK', { country: 'UK' }],
    ['region code EU', { country: 'EU' }],
    ['isActive as text', { isActive: 'true' }],
    ['isActive as number', { isActive: 1 }],
    ['isActive as null', { isActive: null }],
    ['currency (belongs to sales-area data later)', { currency: 'EUR' }],
    ['unexpected property', { salesOrganization: '1000' }],
  ])('should reject %s', async (_case, change) => {
    await expect(
      validate({ ...validCreateBody, ...change }, CreateCustomerDto),
    ).rejects.toThrow(BadRequestException);
  });

  it('should report readable messages that start with the field name', async () => {
    const messages = await messagesFor(
      {
        ...validCreateBody,
        customerNumber: ' CUST-1',
        name: '   ',
        country: 'XX',
      },
      CreateCustomerDto,
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        'customerNumber must not be blank or start or end with whitespace',
        'name must not be blank',
        'country must be a valid ISO 3166-1 alpha-2 country code (e.g. DE)',
      ]),
    );
  });
});

describe('UpdateCustomerDto validation', () => {
  it('should accept a partial update', async () => {
    const body = { city: 'Bremen', isActive: false };

    await expect(validate(body, UpdateCustomerDto)).resolves.toMatchObject(
      body,
    );
  });

  it('should accept an empty update', async () => {
    await expect(validate({}, UpdateCustomerDto)).resolves.toBeDefined();
  });

  it.each([
    ['changing the customerNumber', { customerNumber: 'CUST-9999' }],
    ['whitespace-only name', { name: '   ' }],
    ['null name', { name: null }],
    ['null street', { street: null }],
    ['invalid postalCode', { postalCode: '20 457 #' }],
    ['null city', { city: null }],
    ['unassigned country code', { country: 'QQ' }],
    ['null country', { country: null }],
    ['isActive as text', { isActive: 'false' }],
    ['null isActive', { isActive: null }],
    ['unexpected property', { creditLimit: 5000 }],
  ])('should reject %s', async (_case, body) => {
    await expect(validate(body, UpdateCustomerDto)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('Country code list', () => {
  it('should contain the 249 officially assigned ISO 3166-1 alpha-2 codes', () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    expect(COUNTRY_CODES.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
    expect([...COUNTRY_CODES].sort()).toEqual(COUNTRY_CODES);
  });
});

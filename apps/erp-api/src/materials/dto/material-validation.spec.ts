import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateMaterialDto } from './create-material.dto';
import { UpdateMaterialDto } from './update-material.dto';

// Same options as the global ValidationPipe in main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function validate(
  body: unknown,
  dto: typeof CreateMaterialDto | typeof UpdateMaterialDto,
) {
  return pipe.transform(body, { type: 'body', metatype: dto });
}

const validCreateBody = {
  materialNumber: 'MAT-003',
  description: 'Circulation Pump',
  price: 349.99,
  currency: 'EUR',
};

describe('CreateMaterialDto validation', () => {
  it('should accept a valid material', async () => {
    await expect(validate(validCreateBody, CreateMaterialDto)).resolves.toEqual(
      validCreateBody,
    );
  });

  it.each([['MAT-001'], ['MAT 001'], ['A'], ['100-200/X']])(
    'should keep the valid material number %p unchanged',
    async (materialNumber) => {
      await expect(
        validate({ ...validCreateBody, materialNumber }, CreateMaterialDto),
      ).resolves.toMatchObject({ materialNumber });
    },
  );

  it('should keep inner and outer spaces of a valid description', async () => {
    const description = ' Circulation  Pump ';

    await expect(
      validate({ ...validCreateBody, description }, CreateMaterialDto),
    ).resolves.toMatchObject({ description });
  });

  it.each([
    ['missing materialNumber', { materialNumber: undefined }],
    ['empty materialNumber', { materialNumber: '' }],
    ['numeric materialNumber', { materialNumber: 3 }],
    ['whitespace-only materialNumber', { materialNumber: '   ' }],
    ['tab and newline materialNumber', { materialNumber: '\t\n' }],
    ['materialNumber with leading space', { materialNumber: ' MAT-003' }],
    ['materialNumber with trailing space', { materialNumber: 'MAT-003 ' }],
    ['materialNumber with trailing newline', { materialNumber: 'MAT-003\n' }],
    ['empty description', { description: '' }],
    ['whitespace-only description', { description: '   ' }],
    ['tab and newline description', { description: '\t\n' }],
    ['missing description', { description: undefined }],
    ['price as text', { price: '349.99' }],
    ['zero price', { price: 0 }],
    ['negative price', { price: -1 }],
    ['price with three decimals', { price: 1.999 }],
    ['tiny price that would round to 0.00', { price: 0.0000001 }],
    ['price too large for Decimal(12,2)', { price: 10000000000 }],
    ['lowercase currency', { currency: 'eur' }],
    ['two-letter currency', { currency: 'EU' }],
    ['four-letter currency', { currency: 'EURO' }],
    ['unexpected property', { color: 'red' }],
  ])('should reject %s', async (_case, change) => {
    await expect(
      validate({ ...validCreateBody, ...change }, CreateMaterialDto),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('UpdateMaterialDto validation', () => {
  it('should accept a partial update', async () => {
    const body = {
      description: 'High Efficiency Circulation Pump',
      price: 399.99,
    };

    await expect(validate(body, UpdateMaterialDto)).resolves.toMatchObject(
      body,
    );
  });

  it.each([
    ['changing the materialNumber', { materialNumber: 'MAT-999' }],
    ['empty description', { description: '' }],
    ['whitespace-only description', { description: '   ' }],
    ['null description', { description: null }],
    ['price with three decimals', { price: 399.999 }],
    ['negative price', { price: -5 }],
    ['lowercase currency', { currency: 'usd' }],
    ['unexpected property', { stock: 10 }],
  ])('should reject %s', async (_case, body) => {
    await expect(validate(body, UpdateMaterialDto)).rejects.toThrow(
      BadRequestException,
    );
  });
});

// The backoffice maps messages to form fields by their first word, so the
// wording must stay stable when shared validators change
describe('Material validation messages', () => {
  it('should keep the exact error messages', async () => {
    const error: unknown = await validate(
      {
        materialNumber: ' MAT-003',
        description: '   ',
        price: 1.999,
        currency: 'eur',
      },
      CreateMaterialDto,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      message: expect.arrayContaining([
        'materialNumber must not be blank or start or end with whitespace',
        'description must not be blank',
        'price must have at most two decimal places',
        'currency must be exactly three uppercase letters (e.g. EUR)',
      ]),
    });
  });
});

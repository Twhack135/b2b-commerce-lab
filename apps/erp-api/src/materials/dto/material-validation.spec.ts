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

  it.each([
    ['missing materialNumber', { materialNumber: undefined }],
    ['empty materialNumber', { materialNumber: '' }],
    ['numeric materialNumber', { materialNumber: 3 }],
    ['empty description', { description: '' }],
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

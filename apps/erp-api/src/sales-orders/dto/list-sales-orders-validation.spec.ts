import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListSalesOrdersQueryDto } from './list-sales-orders.dto';

// Same options as the global ValidationPipe in app.setup.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

/** Query parameters as Express parses them: text, or arrays when repeated */
const validate = (query: Record<string, unknown>) =>
  pipe.transform(query, { type: 'query', metatype: ListSalesOrdersQueryDto });

async function messages(query: Record<string, unknown>): Promise<string[]> {
  try {
    await validate(query);
  } catch (error) {
    if (error instanceof BadRequestException) {
      return (error.getResponse() as { message: string[] }).message;
    }
    throw error;
  }
  throw new Error('expected a validation error');
}

const all = {
  q: 'PO-STR',
  salesOrganization: '1000',
  distributionChannel: '10',
  division: '00',
  soldTo: 'CUST-1000',
  unitId: 'UNIT-STUTTGART',
  deliveryBlock: 'SALES_REVIEW',
  orderDateFrom: '2026-11-01',
  orderDateTo: '2026-11-30',
  limit: '50',
  after: '1000000026',
};

describe('ListSalesOrdersQueryDto validation', () => {
  it('accepts no parameters and all parameters together', async () => {
    await expect(validate({})).resolves.toBeInstanceOf(ListSalesOrdersQueryDto);
    await expect(validate(all)).resolves.toEqual(all);
  });

  it('rejects unknown parameters, also internal field names', async () => {
    for (const name of ['page', 'offset', 'before', 'sort', 'requestId']) {
      expect(await messages({ [name]: '1' })).toEqual([
        `property ${name} should not exist`,
      ]);
    }
  });

  it('rejects a repeated parameter (an array)', async () => {
    expect(await messages({ q: ['a', 'b'] })).toContain('q must be a string');
    expect(await messages({ limit: ['10', '20'] })).toContain(
      'limit must be a string',
    );
  });

  describe('q', () => {
    it('accepts up to 100 characters', async () => {
      await expect(validate({ q: 'x'.repeat(100) })).resolves.toBeDefined();
      expect(await messages({ q: 'x'.repeat(101) })).toEqual([
        'q must be shorter than or equal to 100 characters',
      ]);
    });

    it('rejects empty and blank text', async () => {
      for (const q of ['', '   ']) {
        expect(await messages({ q })).toEqual(['q must not be blank']);
      }
    });
  });

  describe('sales area', () => {
    it('accepts a sales organization alone and with a channel', async () => {
      await expect(
        validate({ salesOrganization: '2000' }),
      ).resolves.toBeDefined();
      await expect(
        validate({ salesOrganization: '2000', distributionChannel: '10' }),
      ).resolves.toBeDefined();
    });

    it('rejects a channel or division without the levels above it', async () => {
      expect(await messages({ distributionChannel: '10' })).toEqual([
        'distributionChannel can only be used together with salesOrganization',
      ]);
      expect(
        await messages({ salesOrganization: '1000', division: '00' }),
      ).toEqual([
        'division can only be used together with salesOrganization and distributionChannel',
      ]);
      expect(await messages({ division: '00' })).toEqual([
        'division can only be used together with salesOrganization and distributionChannel',
      ]);
    });

    it('uses the code formats of the sales area key', async () => {
      expect(await messages({ salesOrganization: '100' })).toEqual([
        'salesOrganization must be 4 capital letters or digits, e.g. 1000',
      ]);
      expect(
        await messages({ salesOrganization: '1000', distributionChannel: 'x' }),
      ).toEqual([
        'distributionChannel must be 2 capital letters or digits, e.g. 10',
      ]);
    });
  });

  it('checks soldTo and unitId like other business keys', async () => {
    expect(await messages({ soldTo: ' CUST-1000' })).toEqual([
      'soldTo must not be blank or start or end with whitespace',
    ]);
    expect(await messages({ soldTo: 'C'.repeat(21) })).toEqual([
      'soldTo must be shorter than or equal to 20 characters',
    ]);
    expect(await messages({ unitId: '' })).toEqual([
      'unitId must not be blank or start or end with whitespace',
    ]);
    expect(await messages({ unitId: 'U'.repeat(21) })).toEqual([
      'unitId must be shorter than or equal to 20 characters',
    ]);
  });

  it('accepts SALES_REVIEW and NONE as delivery block only', async () => {
    await expect(validate({ deliveryBlock: 'NONE' })).resolves.toBeDefined();
    for (const deliveryBlock of ['sales_review', 'ANY', '']) {
      expect(await messages({ deliveryBlock })).toEqual([
        'deliveryBlock must be one of: SALES_REVIEW, NONE',
      ]);
    }
  });

  describe('order dates', () => {
    it('rejects invalid dates', async () => {
      for (const date of [
        '2026-02-30',
        '15.11.2026',
        '2026-1-5',
        '1899-12-31',
      ]) {
        expect(await messages({ orderDateFrom: date })).toEqual([
          'orderDateFrom must be a valid date in the form YYYY-MM-DD (years 1900 to 9999)',
        ]);
      }
    });

    it('accepts a range of one day and open ranges', async () => {
      await expect(
        validate({ orderDateFrom: '2026-11-15', orderDateTo: '2026-11-15' }),
      ).resolves.toBeDefined();
      await expect(
        validate({ orderDateTo: '2026-11-15' }),
      ).resolves.toBeDefined();
    });

    it('rejects an end before the start', async () => {
      expect(
        await messages({
          orderDateFrom: '2026-11-16',
          orderDateTo: '2026-11-15',
        }),
      ).toEqual(['orderDateTo must not be before orderDateFrom']);
    });
  });

  it('accepts limit 1 to 100 as whole numbers only', async () => {
    for (const limit of ['1', '25', '99', '100']) {
      await expect(validate({ limit })).resolves.toBeDefined();
    }
    for (const limit of [
      '0',
      '101',
      '-1',
      '1.5',
      '1e1',
      ' 5',
      '05',
      'abc',
      '',
    ]) {
      expect(await messages({ limit })).toEqual([
        'limit must be a whole number from 1 to 100',
      ]);
    }
  });

  it('accepts a 10-digit sales order number as cursor only', async () => {
    for (const after of [
      '100000002',
      '10000000020',
      'abc',
      '',
      '1000000002 ',
    ]) {
      expect(await messages({ after })).toEqual([
        'after must be the nextCursor of a previous page',
      ]);
    }
  });
});

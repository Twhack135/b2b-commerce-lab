import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ReplaceAccountMembersDto } from '../../customer-accounts/dto/replace-account-members.dto';
import { CreateB2bUnitDto } from './create-b2b-unit.dto';
import { UpdateB2bUnitDto } from './update-b2b-unit.dto';

// Same options as the global ValidationPipe in app.setup.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

type Dto =
  | typeof CreateB2bUnitDto
  | typeof UpdateB2bUnitDto
  | typeof ReplaceAccountMembersDto;

function validate(body: unknown, dto: Dto) {
  return pipe.transform(body, { type: 'body', metatype: dto });
}

const validCreateBody = {
  unitId: 'UNIT-1',
  name: 'Hamburg Plant',
  accountCustomerNumber: 'CUST-0001',
  soldToCustomerNumber: 'CUST-0001',
  billToCustomerNumber: 'CUST-0001',
  payerCustomerNumber: 'CUST-0001',
  shipToCustomerNumbers: ['CUST-0001', 'CUST-0002'],
  defaultShipToCustomerNumber: 'CUST-0001',
};

const fiftyOne = Array.from({ length: 51 }, (_, i) => `SH-${i}`);

describe('CreateB2bUnitDto validation', () => {
  it('should accept a valid unit', async () => {
    await expect(
      validate(validCreateBody, CreateB2bUnitDto),
    ).resolves.toMatchObject(validCreateBody);
  });

  it('should accept 50 ship-tos and an explicit status', async () => {
    const shipTos = fiftyOne.slice(0, 50);
    await expect(
      validate(
        {
          ...validCreateBody,
          shipToCustomerNumbers: shipTos,
          defaultShipToCustomerNumber: shipTos[0],
          isActive: false,
        },
        CreateB2bUnitDto,
      ),
    ).resolves.toBeDefined();
  });

  it.each([
    ['missing unitId', { unitId: undefined }],
    ['unitId with trailing space', { unitId: 'UNIT-1 ' }],
    ['unitId longer than 20', { unitId: 'U'.repeat(21) }],
    ['whitespace-only name', { name: '   ' }],
    ['name longer than 100', { name: 'N'.repeat(101) }],
    ['missing accountCustomerNumber', { accountCustomerNumber: undefined }],
    ['blank soldToCustomerNumber', { soldToCustomerNumber: '  ' }],
    ['numeric billToCustomerNumber', { billToCustomerNumber: 1 }],
    [
      'payerCustomerNumber longer than 20',
      { payerCustomerNumber: 'P'.repeat(21) },
    ],
    ['missing shipToCustomerNumbers', { shipToCustomerNumbers: undefined }],
    ['empty shipToCustomerNumbers', { shipToCustomerNumbers: [] }],
    ['more than 50 ship-tos', { shipToCustomerNumbers: fiftyOne }],
    ['duplicate ship-tos', { shipToCustomerNumbers: ['A', 'A'] }],
    ['ship-to with leading space', { shipToCustomerNumbers: [' A'] }],
    ['ship-to as number', { shipToCustomerNumbers: [1] }],
    ['ship-tos as text', { shipToCustomerNumbers: 'CUST-0001' }],
    [
      'missing defaultShipToCustomerNumber',
      { defaultShipToCustomerNumber: undefined },
    ],
    ['isActive as text', { isActive: 'true' }],
    ['isActive as null', { isActive: null }],
    ['unexpected property', { salesOrganization: '1000' }],
  ])('should reject %s', async (_case, change) => {
    await expect(
      validate({ ...validCreateBody, ...change }, CreateB2bUnitDto),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('UpdateB2bUnitDto validation', () => {
  it.each([
    [{ name: 'Renamed' }],
    [{ billToCustomerNumber: 'CUST-0002', payerCustomerNumber: 'CUST-0002' }],
    [
      {
        shipToCustomerNumbers: ['CUST-0002'],
        defaultShipToCustomerNumber: 'CUST-0002',
      },
    ],
    [{ isActive: false }],
    [{}],
  ])('should accept %p', async (body) => {
    await expect(validate(body, UpdateB2bUnitDto)).resolves.toBeDefined();
  });

  it.each([
    ['changing the unitId', { unitId: 'UNIT-2' }],
    ['changing the account', { accountCustomerNumber: 'CUST-0002' }],
    ['changing the Sold-to', { soldToCustomerNumber: 'CUST-0002' }],
    ['null name', { name: null }],
    ['null billToCustomerNumber', { billToCustomerNumber: null }],
    ['empty ship-to list', { shipToCustomerNumbers: [] }],
    ['null ship-to list', { shipToCustomerNumbers: null }],
    ['null default', { defaultShipToCustomerNumber: null }],
    ['isActive as number', { isActive: 0 }],
  ])('should reject %s', async (_case, body) => {
    await expect(validate(body, UpdateB2bUnitDto)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('ReplaceAccountMembersDto validation', () => {
  it.each([[[]], [['CUST-0002', 'CUST-0003']]])(
    'should accept %p',
    async (memberCustomerNumbers) => {
      await expect(
        validate({ memberCustomerNumbers }, ReplaceAccountMembersDto),
      ).resolves.toMatchObject({ memberCustomerNumbers });
    },
  );

  it.each([
    ['missing list', {}],
    ['list as text', { memberCustomerNumbers: 'CUST-0002' }],
    ['duplicates', { memberCustomerNumbers: ['A', 'A'] }],
    ['blank entry', { memberCustomerNumbers: ['  '] }],
    ['entry longer than 20', { memberCustomerNumbers: ['M'.repeat(21)] }],
    ['unexpected property', { memberCustomerNumbers: [], owner: 'X' }],
  ])('should reject %s', async (_case, body) => {
    await expect(validate(body, ReplaceAccountMembersDto)).rejects.toThrow(
      BadRequestException,
    );
  });
});

import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createCustomers,
  createTestApp,
  GERMANY,
  membership,
  resetDatabase,
} from './helpers';

describe('Customer accounts API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Awaited<ReturnType<typeof createTestApp>>['http'];

  beforeAll(async () => {
    ({ app, prisma, http } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createCustomers(
      prisma,
      ['ACC', 'M1', 'M2', 'OLD', 'OTHER', 'OM', 'SLEEP'],
      ['OLD', 'SLEEP'],
    );
    await prisma.customerAccountMember.createMany({
      data: [membership('OTHER', 'OTHER'), membership('OM', 'OTHER')],
    });
  });

  const putMembers = (account: string, members: unknown) =>
    http()
      .put(`/customer-accounts/${account}/members`)
      .send({ memberCustomerNumbers: members });

  const memberRows = () =>
    prisma.customerAccountMember.findMany({
      orderBy: { customerNumber: 'asc' },
    });

  it('creates an account with members and returns it', async () => {
    const response = await putMembers('ACC', ['M1', 'M2']).expect(200);

    expect(response.body).toEqual({
      accountCustomerNumber: 'ACC',
      name: 'Customer ACC',
      isActive: true,
      members: [
        { customerNumber: 'M1', name: 'Customer M1', isActive: true },
        { customerNumber: 'M2', name: 'Customer M2', isActive: true },
      ],
    });
    await http().get('/customer-accounts/ACC').expect(200, response.body);
  });

  it('lists all accounts', async () => {
    await putMembers('ACC', ['M1']).expect(200);

    const response = await http().get('/customer-accounts').expect(200);

    expect(
      (response.body as { accountCustomerNumber: string }[]).map(
        (a) => a.accountCustomerNumber,
      ),
    ).toEqual(['ACC', 'OTHER']);
  });

  it('replaces the member list', async () => {
    await putMembers('ACC', ['M1']).expect(200);
    await putMembers('ACC', ['M2']).expect(200);

    const rows = (await memberRows()).filter(
      (r) => r.accountCustomerNumber === 'ACC',
    );
    expect(rows.map((r) => r.customerNumber)).toEqual(['ACC', 'M2']);
  });

  it('returns 404 for an unknown customer or a customer without account', async () => {
    await putMembers('GHOST', []).expect(404);
    await http().get('/customer-accounts/M1').expect(404);
  });

  it.each([
    [
      'a member of another account',
      'ACC',
      ['OM'],
      'memberCustomerNumbers OM is already a member of account OTHER',
    ],
    [
      'the owner of another account',
      'ACC',
      ['OTHER'],
      'memberCustomerNumbers OTHER owns its own account and cannot be a member of another account',
    ],
    [
      'an inactive new member',
      'ACC',
      ['OLD'],
      'memberCustomerNumbers OLD is inactive',
    ],
    [
      'an unknown member',
      'ACC',
      ['GHOST'],
      'memberCustomerNumbers GHOST does not exist',
    ],
    [
      'an owner that is a member elsewhere',
      'OM',
      [],
      'accountCustomerNumber OM is a member of account OTHER and cannot own an account',
    ],
    [
      'an inactive new owner',
      'SLEEP',
      [],
      'accountCustomerNumber SLEEP is inactive',
    ],
    [
      'the owner in its own member list',
      'ACC',
      ['ACC'],
      'memberCustomerNumbers must not contain the account owner ACC',
    ],
  ])(
    'rejects %s with 422 and changes nothing',
    async (_case, account, members, message) => {
      const before = await memberRows();

      const response = await putMembers(account, members).expect(422);

      expect(response.body).toEqual({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: [message],
      });
      await expect(memberRows()).resolves.toEqual(before);
    },
  );

  it('keeps a member that became inactive', async () => {
    await putMembers('ACC', ['M1']).expect(200);
    await http().patch('/customers/M1').send({ isActive: false }).expect(200);

    const response = await putMembers('ACC', ['M1', 'M2']).expect(200);

    expect(response.body.members).toEqual([
      { customerNumber: 'M1', name: 'Customer M1', isActive: false },
      { customerNumber: 'M2', name: 'Customer M2', isActive: true },
    ]);
  });

  it('rejects removing a member that is used by a B2B unit with 409', async () => {
    await putMembers('ACC', ['M1']).expect(200);
    await http()
      .post('/b2b-units')
      .send({
        unitId: 'UNIT-1',
        name: 'Unit 1',
        ...GERMANY,
        accountCustomerNumber: 'ACC',
        soldToCustomerNumber: 'ACC',
        billToCustomerNumber: 'ACC',
        payerCustomerNumber: 'ACC',
        shipToCustomerNumbers: ['M1'],
        defaultShipToCustomerNumber: 'M1',
      })
      .expect(201);

    const response = await putMembers('ACC', []).expect(409);

    expect(response.body.message).toEqual([
      'memberCustomerNumbers M1 is still used as a partner in B2B unit UNIT-1',
    ]);
  });

  it('rejects invalid request bodies with 400', async () => {
    await putMembers('ACC', ['M1', 'M1']).expect(400);
    await putMembers('ACC', 'M1').expect(400);
    await http()
      .put('/customer-accounts/ACC/members')
      .send({ memberCustomerNumbers: [], extra: true })
      .expect(400);
  });
});

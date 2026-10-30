// Concurrent complete-list replacements must never merge two lists, never
// leave more or less than one default ship-to and never answer with HTTP 500.
// Every scenario is repeated several times, because timing differs per run.
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  createCustomers,
  createTestApp,
  GERMANY,
  membership,
  resetDatabase,
} from './helpers';

const ROUNDS = 10;
const ORIGINAL_SHIP_TOS = ['SH1', 'SH2'];

type ShipToChange = {
  shipToCustomerNumbers?: string[];
  defaultShipToCustomerNumber?: string;
};

type Response = { status: number; body: unknown };

describe('Concurrent updates (PostgreSQL row locks)', () => {
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
    await createCustomers(prisma, [
      'ACC',
      'SH1',
      'SH2',
      'SH3',
      'SH4',
      'ACC2',
      'M1',
      'M2',
      'M3',
      'FREE',
    ]);
    await prisma.customerAccountMember.createMany({
      data: ['ACC', 'SH1', 'SH2', 'SH3', 'SH4'].map((c) =>
        membership(c, 'ACC'),
      ),
    });
  });

  const createUnit = (unitId: string) =>
    http()
      .post('/b2b-units')
      .send({
        unitId,
        name: unitId,
        ...GERMANY,
        accountCustomerNumber: 'ACC',
        soldToCustomerNumber: 'ACC',
        billToCustomerNumber: 'ACC',
        payerCustomerNumber: 'ACC',
        shipToCustomerNumbers: ORIGINAL_SHIP_TOS,
        defaultShipToCustomerNumber: 'SH1',
      })
      .expect(201);

  const storedShipTos = async (unitId: string) => {
    const rows = await prisma.b2bUnitShipTo.findMany({
      where: { unitId },
      orderBy: { customerNumber: 'asc' },
    });
    return {
      list: rows.map((r) => r.customerNumber),
      defaults: rows.filter((r) => r.isDefault).map((r) => r.customerNumber),
    };
  };

  const sorted = (list: string[]) => [...list].sort();

  /** The list the unit would have if only this request had been applied */
  const listAfter = (change: ShipToChange) =>
    sorted(change.shipToCustomerNumbers ?? ORIGINAL_SHIP_TOS);

  describe('ship-to list replacements on the same unit', () => {
    // orderIndependent: both requests are valid whichever runs first.
    // Otherwise the request that runs second is checked against the state
    // left by the first one and may correctly be rejected with 422, e.g. if
    // it keeps a default that the first request removed.
    const scenarios: {
      name: string;
      a: ShipToChange;
      b: ShipToChange;
      orderIndependent: boolean;
    }[] = [
      {
        name: 'both add a different ship-to',
        a: { shipToCustomerNumbers: ['SH1', 'SH2', 'SH3'] },
        b: { shipToCustomerNumbers: ['SH1', 'SH2', 'SH4'] },
        orderIndependent: true,
      },
      {
        name: 'one removes a ship-to, the other removes the default',
        orderIndependent: false,
        a: { shipToCustomerNumbers: ['SH1'] },
        b: {
          shipToCustomerNumbers: ['SH2'],
          defaultShipToCustomerNumber: 'SH2',
        },
      },
      {
        name: 'both replace the list and the default',
        orderIndependent: true,
        a: {
          shipToCustomerNumbers: ['SH2', 'SH3'],
          defaultShipToCustomerNumber: 'SH3',
        },
        b: {
          shipToCustomerNumbers: ['SH3', 'SH4'],
          defaultShipToCustomerNumber: 'SH4',
        },
      },
      {
        name: 'one switches the default, the other replaces the list',
        orderIndependent: false,
        a: { defaultShipToCustomerNumber: 'SH2' },
        b: {
          shipToCustomerNumbers: ['SH3'],
          defaultShipToCustomerNumber: 'SH3',
        },
      },
    ];

    it.each(scenarios)(
      '$name: the last successful request wins completely',
      async ({ a, b, orderIndependent }) => {
        for (let round = 0; round < ROUNDS; round++) {
          const unitId = `U-${round}`;
          await createUnit(unitId);

          const responses: Response[] = await Promise.all([
            http().patch(`/b2b-units/${unitId}`).send(a),
            http().patch(`/b2b-units/${unitId}`).send(b),
          ]);
          const stored = await storedShipTos(unitId);

          // The row lock serializes the requests: no server errors and no
          // technical conflicts (409), only applied (200) or a business
          // rejection against the current state (422)
          if (orderIndependent) {
            expect(responses.map((r) => r.status)).toEqual([200, 200]);
          } else {
            expect(responses.map((r) => r.status)).toContain(200);
            for (const response of responses.filter((r) => r.status !== 200)) {
              expect(response).toMatchObject({
                status: 422,
                body: {
                  message: [
                    'defaultShipToCustomerNumber must be one of shipToCustomerNumbers',
                  ],
                },
              });
            }
          }
          // Exactly one default, and it is one of the stored ship-tos
          expect(stored.defaults).toHaveLength(1);
          expect(stored.list).toContain(stored.defaults[0]);

          // The stored list is exactly the list of one successful request,
          // never a mix of both
          const candidates = [a, b]
            .filter((_, i) => responses[i].status === 200)
            .map(listAfter);
          expect(candidates).toContainEqual(stored.list);
        }
      },
    );

    it('keeps the last list when many requests run at the same time', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const unitId = `MANY-${round}`;
        await createUnit(unitId);
        const lists = [['SH1'], ['SH2'], ['SH3'], ['SH4'], ['SH1', 'SH4']];

        const responses = await Promise.all(
          lists.map((list) =>
            http().patch(`/b2b-units/${unitId}`).send({
              shipToCustomerNumbers: list,
              defaultShipToCustomerNumber: list[0],
            }),
          ),
        );
        const stored = await storedShipTos(unitId);

        expect(responses.map((r) => r.status)).toEqual([
          200, 200, 200, 200, 200,
        ]);
        expect(lists.map(sorted)).toContainEqual(stored.list);
        expect(stored.defaults).toHaveLength(1);
      }
    });
  });

  describe('lock scope', () => {
    it('does not block updates of other units', async () => {
      await createUnit('LOCKED');
      await createUnit('FREE-UNIT');
      const HOLD_MS = 1500;

      // Hold the lock on LOCKED in a separate transaction for a while
      let releaseStarted!: () => void;
      const lockTaken = new Promise<void>(
        (resolve) => (releaseStarted = resolve),
      );
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT unit_id FROM b2b_units WHERE unit_id = 'LOCKED' FOR UPDATE`;
          releaseStarted();
          await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
        },
        { timeout: HOLD_MS * 4 },
      );
      await lockTaken;

      const timed = async (unitId: string) => {
        const start = Date.now();
        const response = await http()
          .patch(`/b2b-units/${unitId}`)
          .send({
            shipToCustomerNumbers: ['SH3'],
            defaultShipToCustomerNumber: 'SH3',
          });
        return { status: response.status, ms: Date.now() - start };
      };

      const [lockedUnit, otherUnit] = await Promise.all([
        timed('LOCKED'),
        timed('FREE-UNIT'),
      ]);
      await holder;

      // The other unit is updated right away, the locked one waits and then succeeds
      expect(otherUnit.status).toBe(200);
      expect(otherUnit.ms).toBeLessThan(HOLD_MS / 2);
      expect(lockedUnit.status).toBe(200);
      expect(lockedUnit.ms).toBeGreaterThanOrEqual(HOLD_MS / 2);
      await expect(storedShipTos('LOCKED')).resolves.toEqual({
        list: ['SH3'],
        defaults: ['SH3'],
      });
    });

    it('updates many different units in parallel without conflicts', async () => {
      const unitIds = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
      for (const unitId of unitIds) await createUnit(unitId);

      const responses = await Promise.all(
        unitIds.map((unitId, i) =>
          http()
            .patch(`/b2b-units/${unitId}`)
            .send({
              shipToCustomerNumbers: i % 2 ? ['SH3', 'SH4'] : ['SH4'],
              defaultShipToCustomerNumber: 'SH4',
            }),
        ),
      );

      expect(responses.map((r) => r.status)).toEqual(unitIds.map(() => 200));
      for (const [i, unitId] of unitIds.entries()) {
        await expect(storedShipTos(unitId)).resolves.toEqual({
          list: i % 2 ? ['SH3', 'SH4'] : ['SH4'],
          defaults: ['SH4'],
        });
      }
    });
  });

  describe('account membership replacements', () => {
    const putMembers = (account: string, members: string[]) =>
      http()
        .put(`/customer-accounts/${account}/members`)
        .send({ memberCustomerNumbers: members });

    const storedMembers = async (account: string) =>
      (
        await prisma.customerAccountMember.findMany({
          where: {
            accountCustomerNumber: account,
            NOT: { customerNumber: account },
          },
          orderBy: { customerNumber: 'asc' },
        })
      ).map((row) => row.customerNumber);

    it('never merges two member lists of the same account', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await resetDatabase(prisma);
        await createCustomers(prisma, ['ACC2', 'M1', 'M2', 'M3']);
        await putMembers('ACC2', ['M1']).expect(200);

        const lists = [
          ['M1', 'M2'],
          ['M1', 'M3'],
        ];
        const responses = await Promise.all(
          lists.map((list) => putMembers('ACC2', list)),
        );

        expect(responses.map((r) => r.status)).toEqual([200, 200]);
        expect(lists).toContainEqual(await storedMembers('ACC2'));
      }
    });

    it('creates a new account exactly once when two requests create it at the same time', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await resetDatabase(prisma);
        await createCustomers(prisma, ['ACC2', 'M1', 'M2']);

        const lists = [['M1'], ['M2']];
        const responses = await Promise.all(
          lists.map((list) => putMembers('ACC2', list)),
        );

        expect(responses.map((r) => r.status)).toEqual([200, 200]);
        const ownerRows = await prisma.customerAccountMember.count({
          where: { customerNumber: 'ACC2', accountCustomerNumber: 'ACC2' },
        });
        expect(ownerRows).toBe(1);
        expect(lists).toContainEqual(await storedMembers('ACC2'));
      }
    });

    it('gives a free customer to exactly one of two accounts claiming it at the same time', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await resetDatabase(prisma);
        await createCustomers(prisma, ['ACC', 'ACC2', 'FREE']);

        const responses = await Promise.all([
          putMembers('ACC', ['FREE']),
          putMembers('ACC2', ['FREE']),
        ]);

        // One wins; the other is told about the conflict, never a 500
        expect(sorted(responses.map((r) => String(r.status)))).toEqual(
          responses.some((r) => r.status === 422)
            ? ['200', '422']
            : ['200', '409'],
        );
        const rows = await prisma.customerAccountMember.findMany({
          where: { customerNumber: 'FREE' },
        });
        expect(rows).toHaveLength(1);
      }
    });

    it('keeps genuine 404 responses for missing resources', async () => {
      await putMembers('GHOST', []).expect(404);
      await http().patch('/b2b-units/GHOST').send({ name: 'X' }).expect(404);
    });
  });
});

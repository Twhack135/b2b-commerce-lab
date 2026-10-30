// Proves that readOnlyTransaction really is read-only and sees one snapshot.
// The order simulation relies on this to never change any data.
import { INestApplication } from '@nestjs/common';
import { readOnlyTransaction } from '../../src/prisma/read-only-transaction';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp, resetDatabase } from './helpers';

/** The PostgreSQL error code of a failed statement, or 'ok' */
async function codeOf(statement: Promise<unknown>) {
  const error = await statement.then(
    () => null,
    (e: unknown) => e,
  );
  if (error === null) return 'ok';
  const meta = (error as { meta?: Record<string, unknown> }).meta;
  const adapterError = meta?.driverAdapterError as
    { cause?: { originalCode?: string } } | undefined;
  return adapterError?.cause?.originalCode ?? (error as Error).message;
}

const READ_ONLY_VIOLATION = '25006';

describe('readOnlyTransaction (REPEATABLE READ, READ ONLY)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.material.create({
      data: { materialNumber: 'MAT-1', description: 'Heat Pump' },
    });
  });

  it('runs with isolation level REPEATABLE READ and read-only mode', async () => {
    const settings = await readOnlyTransaction(prisma, async (tx) => {
      const [isolation] = await tx.$queryRaw<{ value: string }[]>`
        SELECT current_setting('transaction_isolation') AS value`;
      const [readOnly] = await tx.$queryRaw<{ value: string }[]>`
        SELECT current_setting('transaction_read_only') AS value`;
      return { isolation: isolation.value, readOnly: readOnly.value };
    });

    expect(settings).toEqual({ isolation: 'repeatable read', readOnly: 'on' });
  });

  it.each([
    [
      'INSERT via Prisma',
      (tx: Parameters<Parameters<typeof readOnlyTransaction>[1]>[0]) =>
        tx.material.create({
          data: { materialNumber: 'MAT-2', description: 'x' },
        }),
    ],
    [
      'UPDATE via Prisma',
      (tx: Parameters<Parameters<typeof readOnlyTransaction>[1]>[0]) =>
        tx.material.update({
          where: { materialNumber: 'MAT-1' },
          data: { description: 'x' },
        }),
    ],
    [
      'DELETE via raw SQL',
      (tx: Parameters<Parameters<typeof readOnlyTransaction>[1]>[0]) =>
        tx.$executeRaw`DELETE FROM materials`,
    ],
    [
      'SELECT ... FOR UPDATE',
      (tx: Parameters<Parameters<typeof readOnlyTransaction>[1]>[0]) =>
        tx.$queryRaw`SELECT * FROM materials FOR UPDATE`,
    ],
  ])('rejects %s', async (_case, write) => {
    await expect(
      codeOf(readOnlyTransaction(prisma, (tx) => write(tx))),
    ).resolves.toBe(READ_ONLY_VIOLATION);

    const stored = await prisma.material.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].description).toBe('Heat Pump');
  });

  it('sees one snapshot even if data changes during the transaction', async () => {
    const descriptions = await readOnlyTransaction(prisma, async (tx) => {
      const before = await tx.material.findUniqueOrThrow({
        where: { materialNumber: 'MAT-1' },
      });
      // Committed by another connection while the transaction is open
      await prisma.material.update({
        where: { materialNumber: 'MAT-1' },
        data: { description: 'Heat Pump XL' },
      });
      const after = await tx.material.findUniqueOrThrow({
        where: { materialNumber: 'MAT-1' },
      });
      return [before.description, after.description];
    });

    expect(descriptions).toEqual(['Heat Pump', 'Heat Pump']);
    const committed = await prisma.material.findUniqueOrThrow({
      where: { materialNumber: 'MAT-1' },
    });
    expect(committed.description).toBe('Heat Pump XL');
  });

  it('leaves later transactions and writes unaffected', async () => {
    for (let i = 0; i < 5; i++) {
      await readOnlyTransaction(prisma, (tx) => tx.material.count());
    }

    await expect(
      codeOf(
        prisma.material.update({
          where: { materialNumber: 'MAT-1' },
          data: { description: 'Heat Pump 2' },
        }),
      ),
    ).resolves.toBe('ok');
    await expect(
      codeOf(
        prisma.$transaction((tx) =>
          tx.material.update({
            where: { materialNumber: 'MAT-1' },
            data: { description: 'Heat Pump 3' },
          }),
        ),
      ),
    ).resolves.toBe('ok');
  });
});

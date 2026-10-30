import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  checkTestDatabase,
  developmentDatabaseUrl,
  type TestDatabaseSettings,
} from './database-safety';
import e2eSafetyGuard from './e2e-safety-guard';

// Only shapes of URLs, no real credentials
const TEST_URL =
  'postgresql://erp_user:secret@127.0.0.1:55435/b2b_erp_e2e_test';
const DEV_URL = 'postgresql://erp_user:secret@127.0.0.1:5432/b2b_erp';

const settings = (
  env: Record<string, string | undefined>,
  developmentUrl: string | undefined = DEV_URL,
): TestDatabaseSettings => ({
  marker: 'ERP_E2E_TEST',
  command: 'npm run test:e2e',
  env,
  developmentUrl,
});
const safe = { ERP_E2E_TEST: '1', DATABASE_URL: TEST_URL };

describe('checkTestDatabase', () => {
  it('accepts a disposable local test database', () => {
    expect(checkTestDatabase(settings(safe))).toEqual({
      host: '127.0.0.1',
      port: '55435',
      database: 'b2b_erp_e2e_test',
    });
    expect(
      checkTestDatabase(
        settings({
          ...safe,
          DATABASE_URL: 'postgres://u:p@localhost:55433/b2b_erp_int_test',
        }),
      ).database,
    ).toBe('b2b_erp_int_test');
  });

  it('rejects the development database from the root .env', () => {
    expect(() =>
      checkTestDatabase(settings({ ...safe, DATABASE_URL: DEV_URL })),
    ).toThrow(
      '127.0.0.1:5432/b2b_erp: only a database whose name ends with "_test" is allowed.',
    );
  });

  it('rejects a test database on the server of the development database', () => {
    expect(() =>
      checkTestDatabase(
        settings({
          ...safe,
          DATABASE_URL: 'postgresql://u:p@localhost:5432/b2b_erp_test',
        }),
      ),
    ).toThrow('is on the server of the development database');
  });

  it('fails closed without the marker of the test runner', () => {
    expect(() =>
      checkTestDatabase(settings({ DATABASE_URL: TEST_URL })),
    ).toThrow('ERP_E2E_TEST is not set.');
    expect(() =>
      checkTestDatabase(settings({ ...safe, ERP_E2E_TEST: 'true' })),
    ).toThrow('ERP_E2E_TEST is not set.');
  });

  it.each([undefined, '', '   '])(
    'rejects a missing DATABASE_URL (%p)',
    (url) => {
      expect(() =>
        checkTestDatabase(settings({ ...safe, DATABASE_URL: url })),
      ).toThrow('DATABASE_URL is not set.');
    },
  );

  it.each([
    ['not a url', 'DATABASE_URL is not a valid URL.'],
    ['mysql://u:p@127.0.0.1:3306/x_test', 'is not a PostgreSQL URL'],
    ['postgresql://u:p@db.example.com:5432/x_test', 'is not a local database'],
    ['postgresql://u:p@10.0.0.5:55433/x_test', 'is not a local database'],
    ['postgresql://u:p@127.0.0.1:55433/', 'name ends with "_test"'],
    ['postgresql://u:p@127.0.0.1:55433/b2b_erp', 'name ends with "_test"'],
    ['postgresql://u:p@127.0.0.1:55433/test_b2b_erp', 'name ends with "_test"'],
    [
      'postgresql://u:p@127.0.0.1:55433/a_test/b2b_erp',
      'name ends with "_test"',
    ],
  ])('rejects the unsafe URL %s', (url, message) => {
    expect(() =>
      checkTestDatabase(settings({ ...safe, DATABASE_URL: url })),
    ).toThrow(message);
  });

  it.each([
    'host',
    'hostaddr',
    'port',
    'dbname',
    'database',
    'service',
    'options',
  ])('rejects the redirecting URL parameter %s', (param) => {
    expect(() =>
      checkTestDatabase(
        settings({ ...safe, DATABASE_URL: `${TEST_URL}?${param}=b2b_erp` }),
      ),
    ).toThrow(`must not contain the parameter ${param}`);
  });

  it('keeps harmless URL parameters', () => {
    expect(() =>
      checkTestDatabase(
        settings({ ...safe, DATABASE_URL: `${TEST_URL}?connect_timeout=5` }),
      ),
    ).not.toThrow();
  });

  it.each(['PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGSERVICE'])(
    'rejects the ambiguous variable %s',
    (name) => {
      expect(() =>
        checkTestDatabase(settings({ ...safe, [name]: 'b2b_erp' })),
      ).toThrow(`${name} must not be set for tests.`);
    },
  );

  it('never shows credentials in messages', () => {
    try {
      checkTestDatabase(settings({ ...safe, DATABASE_URL: DEV_URL }));
    } catch (error) {
      expect((error as Error).message).not.toContain('secret');
      expect((error as Error).message).toContain('npm run test:e2e');
      return;
    }
    throw new Error('expected a rejection');
  });
});

describe('developmentDatabaseUrl', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'db-safety-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads DATABASE_URL from an .env file without changing process.env', () => {
    const file = path.join(dir, '.env');
    writeFileSync(file, `POSTGRES_PASSWORD=x\nDATABASE_URL=${DEV_URL}\n`);
    const before = process.env.DATABASE_URL;
    expect(developmentDatabaseUrl(file)).toBe(DEV_URL);
    expect(process.env.DATABASE_URL).toBe(before);
  });

  it('returns undefined without an .env file', () => {
    expect(
      developmentDatabaseUrl(path.join(dir, 'missing.env')),
    ).toBeUndefined();
  });
});

describe('e2e safety guard (Jest globalSetup)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('refuses before connecting when the e2e runner did not start the tests', async () => {
    process.env = { ...saved, DATABASE_URL: DEV_URL };
    delete process.env.ERP_E2E_TEST;
    await expect(e2eSafetyGuard()).rejects.toThrow('ERP_E2E_TEST is not set.');
  });

  it('refuses the development database even with the marker', async () => {
    process.env = { ...saved, ERP_E2E_TEST: '1', DATABASE_URL: DEV_URL };
    await expect(e2eSafetyGuard()).rejects.toThrow(
      'only a database whose name ends with "_test" is allowed',
    );
  });
});

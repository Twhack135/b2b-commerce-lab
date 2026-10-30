// Shared safety check for every test suite that talks to a real database.
// Integration and e2e tests may change data, so they must only ever run
// against a disposable local test database, never against the development
// database configured in the root .env. The check fails closed: anything
// missing, ambiguous or unexpected is rejected.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { Client } from 'pg';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/** The database of the development environment (see .env.example) */
export const DEVELOPMENT_DATABASE = 'b2b_erp';

/** Query parameters that could redirect the connection behind the URL */
const REDIRECTING_PARAMS = [
  'host',
  'hostaddr',
  'port',
  'dbname',
  'database',
  'service',
  'options',
];

/** libpq/pg variables that would make the target ambiguous */
const AMBIGUOUS_ENV = [
  'PGHOST',
  'PGHOSTADDR',
  'PGPORT',
  'PGDATABASE',
  'PGSERVICE',
];

export interface TestDatabaseSettings {
  /** Name of the variable the test runner sets, e.g. ERP_E2E_TEST */
  marker: string;
  /** The command that creates the disposable database */
  command: string;
  /** Effective environment after all .env files were loaded */
  env: Record<string, string | undefined>;
  /** DATABASE_URL of the development environment, if known */
  developmentUrl?: string;
}

export interface TestDatabase {
  host: string;
  port: string;
  database: string;
}

/** Host, port and database of a URL without credentials (for messages) */
function describe(target: TestDatabase): string {
  return `${target.host}:${target.port}/${target.database}`;
}

function targetOf(url: URL): TestDatabase {
  return {
    host: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
    port: url.port || '5432',
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

/**
 * Returns the test database, or throws with every reason why the
 * configuration is not a safe disposable test database.
 */
export function checkTestDatabase(
  settings: TestDatabaseSettings,
): TestDatabase {
  const { marker, command, env, developmentUrl } = settings;
  const fail = (reason: string): never => {
    throw new Error(
      `Refusing to run tests: ${reason} Start them with "${command}", which creates a disposable test database.`,
    );
  };

  if (env[marker] !== '1') {
    fail(`${marker} is not set.`);
  }
  const raw = env.DATABASE_URL;
  if (!raw?.trim()) {
    fail('DATABASE_URL is not set.');
  }

  let url: URL;
  try {
    url = new URL(raw!);
  } catch {
    return fail('DATABASE_URL is not a valid URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    fail('DATABASE_URL is not a PostgreSQL URL.');
  }

  const ambiguous = AMBIGUOUS_ENV.filter((name) => env[name]);
  if (ambiguous.length > 0) {
    fail(`${ambiguous.join(', ')} must not be set for tests.`);
  }
  const params = REDIRECTING_PARAMS.filter((name) =>
    url.searchParams.has(name),
  );
  if (params.length > 0) {
    fail(`DATABASE_URL must not contain the parameter ${params.join(', ')}.`);
  }

  const target = targetOf(url);
  if (!LOCAL_HOSTS.includes(url.hostname)) {
    fail(`${describe(target)} is not a local database.`);
  }
  if (!/^[a-z0-9_]+_test$/.test(target.database)) {
    fail(
      `${describe(target)}: only a database whose name ends with "_test" is allowed.`,
    );
  }

  if (developmentUrl) {
    let development: TestDatabase | undefined;
    try {
      development = targetOf(new URL(developmentUrl));
    } catch {
      // An unreadable development URL cannot match a valid test URL
    }
    if (
      development &&
      development.host === target.host &&
      development.port === target.port
    ) {
      fail(`${describe(target)} is on the server of the development database.`);
    }
  }
  return target;
}

/** DATABASE_URL from the root .env, read without changing process.env */
export function developmentDatabaseUrl(
  envFile = path.join(__dirname, '..', '..', '..', '.env'),
): string | undefined {
  if (!existsSync(envFile)) return undefined;
  return parseEnv(readFileSync(envFile, 'utf8')).DATABASE_URL;
}

/**
 * Connects to the configured database and checks that the server really
 * answers with the expected test database.
 */
export async function checkConnectedDatabase(
  url: string,
  expected: TestDatabase,
): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ database: string }>(
      'SELECT current_database() AS database',
    );
    const actual = rows[0]?.database;
    if (actual !== expected.database || actual === DEVELOPMENT_DATABASE) {
      throw new Error(
        `Refusing to run tests: connected to database "${actual}", expected "${expected.database}".`,
      );
    }
  } finally {
    await client.end();
  }
}

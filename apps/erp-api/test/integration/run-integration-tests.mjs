// Runs the integration tests against a disposable PostgreSQL database.
//
// 1. Checks that Docker is available (fails with a clear message otherwise;
//    the tests are never skipped silently)
// 2. Starts a throwaway PostgreSQL 18 container whose data lives only in
//    memory (tmpfs) and that removes itself when stopped (--rm)
// 3. Applies all Prisma migrations to it
// 4. Runs Jest with test/jest-int.json against that database
// 5. Always stops the container, also when tests fail
//
// The development database from the root .env is never used: DATABASE_URL is
// set explicitly and takes precedence over values loaded from .env files.
//
// Usage: npm run test:int [-- <extra jest arguments>]
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const CONTAINER = `b2b-erp-int-test-${randomBytes(4).toString('hex')}`;
const PORT = process.env.INT_TEST_DB_PORT ?? '55433';
const DATABASE = 'b2b_erp_int_test';
const USER = 'erp_user';
const PASSWORD = randomBytes(16).toString('hex');
const READY_TIMEOUT_MS = 60_000;

function abort(message) {
  console.error(`\n✖ Integration tests could not run: ${message}\n`);
  process.exit(1);
}

function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8' });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 1. Docker must be running
const info = docker(['info', '--format', '{{.ServerVersion}}']);
if (info.error || info.status !== 0) {
  abort(
    'Docker is not available. Start Docker Desktop and run "npm run test:int" again.\n' +
      `  Details: ${(info.error?.message ?? info.stderr ?? '').trim()}`,
  );
}

// 2. Start the throwaway database
const started = docker([
  'run',
  '--detach',
  '--rm',
  '--name',
  CONTAINER,
  '--env',
  `POSTGRES_USER=${USER}`,
  '--env',
  `POSTGRES_PASSWORD=${PASSWORD}`,
  '--env',
  `POSTGRES_DB=${DATABASE}`,
  '--publish',
  `127.0.0.1:${PORT}:5432`,
  '--tmpfs',
  '/var/lib/postgresql',
  'postgres:18',
]);
if (started.status !== 0) {
  abort(
    `the PostgreSQL test container could not be started (is port ${PORT} free?).\n` +
      `  Details: ${started.stderr.trim()}`,
  );
}
console.log(
  `Started disposable test database ${DATABASE} in container ${CONTAINER}`,
);

let exitCode = 1;
try {
  // 3. Wait until PostgreSQL accepts TCP connections. During its first-time
  // setup the server only listens on a local socket, so a TCP check avoids
  // connecting too early.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let readyChecks = 0;
  while (readyChecks < 2) {
    if (Date.now() > deadline) {
      throw new Error(
        'the test database did not become ready within 60 seconds',
      );
    }
    const ready = docker([
      'exec',
      CONTAINER,
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      USER,
      '-d',
      DATABASE,
    ]);
    readyChecks = ready.status === 0 ? readyChecks + 1 : 0;
    sleep(500);
  }

  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}`,
    ERP_INTEGRATION_TEST: '1',
  };

  // 4. Apply all migrations
  const migrate = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    { env, stdio: 'inherit' },
  );
  if (migrate.status !== 0) {
    throw new Error('applying the migrations to the test database failed');
  }

  // 5. Run the integration tests one file at a time (they share the database)
  const jest = spawnSync(
    process.execPath,
    [
      '--experimental-vm-modules',
      'node_modules/jest/bin/jest.js',
      '--config',
      'test/jest-int.json',
      '--runInBand',
      ...process.argv.slice(2),
    ],
    { env, stdio: 'inherit' },
  );
  exitCode = jest.status ?? 1;
} catch (error) {
  console.error(`\n✖ Integration tests failed: ${error.message}\n`);
  exitCode = 1;
} finally {
  docker(['stop', CONTAINER]);
  console.log(`Stopped and removed container ${CONTAINER}`);
}

process.exit(exitCode);

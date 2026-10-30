// Runs a Jest suite against a disposable PostgreSQL database.
//
// 1. Checks that Docker is available (fails with a clear message otherwise;
//    the tests are never skipped silently)
// 2. Starts a throwaway PostgreSQL 18 container whose data lives only in
//    memory (tmpfs) and that removes itself when stopped (--rm)
// 3. Applies all Prisma migrations to it
// 4. Runs Jest with the given config against that database
// 5. Always stops the container, also when tests fail
//
// The development database from the root .env is never used: DATABASE_URL is
// set explicitly and takes precedence over values loaded from .env files.
// The suites check this again themselves (see test/database-safety.ts).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const USER = 'erp_user';
const READY_TIMEOUT_MS = 60_000;

function docker(args) {
  return spawnSync('docker', args, { encoding: 'utf8' });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * @param {object} suite
 * @param {string} suite.name        e.g. "Integration tests"
 * @param {string} suite.command     e.g. "npm run test:int"
 * @param {string} suite.container   container name prefix
 * @param {string} suite.database    database name, must end with "_test"
 * @param {string} suite.port        local port of the container
 * @param {string} suite.jestConfig  path of the Jest config
 * @param {string} suite.marker      variable the suite's safety guard expects
 * @param {string[]} suite.jestArgs  extra Jest arguments
 */
export function runWithDisposableDatabase(suite) {
  const container = `${suite.container}-${randomBytes(4).toString('hex')}`;
  const password = randomBytes(16).toString('hex');

  function abort(message) {
    console.error(`\n✖ ${suite.name} could not run: ${message}\n`);
    process.exit(1);
  }

  // 1. Docker must be running
  const info = docker(['info', '--format', '{{.ServerVersion}}']);
  if (info.error || info.status !== 0) {
    abort(
      `Docker is not available. Start Docker Desktop and run "${suite.command}" again.\n` +
        `  Details: ${(info.error?.message ?? info.stderr ?? '').trim()}`,
    );
  }

  // 2. Start the throwaway database
  const started = docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    container,
    '--env',
    `POSTGRES_USER=${USER}`,
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    '--env',
    `POSTGRES_DB=${suite.database}`,
    '--publish',
    `127.0.0.1:${suite.port}:5432`,
    '--tmpfs',
    '/var/lib/postgresql',
    'postgres:18',
  ]);
  if (started.status !== 0) {
    abort(
      `the PostgreSQL test container could not be started (is port ${suite.port} free?).\n` +
        `  Details: ${started.stderr.trim()}`,
    );
  }
  console.log(
    `Started disposable test database ${suite.database} in container ${container}`,
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
        container,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        USER,
        '-d',
        suite.database,
      ]);
      readyChecks = ready.status === 0 ? readyChecks + 1 : 0;
      sleep(500);
    }

    const env = {
      ...process.env,
      DATABASE_URL: `postgresql://${USER}:${password}@127.0.0.1:${suite.port}/${suite.database}`,
      [suite.marker]: '1',
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

    // 5. Run the tests one file at a time (they share the database)
    const jest = spawnSync(
      process.execPath,
      [
        '--experimental-vm-modules',
        'node_modules/jest/bin/jest.js',
        '--config',
        suite.jestConfig,
        '--runInBand',
        ...suite.jestArgs,
      ],
      { env, stdio: 'inherit' },
    );
    exitCode = jest.status ?? 1;
  } catch (error) {
    console.error(`\n✖ ${suite.name} failed: ${error.message}\n`);
    exitCode = 1;
  } finally {
    docker(['stop', container]);
    console.log(`Stopped and removed container ${container}`);
  }

  process.exit(exitCode);
}

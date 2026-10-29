// Runs before every integration test file. The integration tests delete
// data, so they must only ever run against the disposable test database
// created by test/integration/run-integration-tests.mjs.

const url = process.env.DATABASE_URL;

if (process.env.ERP_INTEGRATION_TEST !== '1' || !url) {
  throw new Error(
    'Integration tests must be started with "npm run test:int", which creates a disposable test database.',
  );
}

const { hostname, pathname } = new URL(url);
if (
  !['127.0.0.1', 'localhost'].includes(hostname) ||
  !pathname.endsWith('_test')
) {
  throw new Error(
    `Refusing to run integration tests against ${hostname}${pathname}: only a local database whose name ends with "_test" is allowed.`,
  );
}

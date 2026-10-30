// Runs the e2e tests against a disposable PostgreSQL database
// (see test/disposable-database.mjs). The root .env is not loaded, so the
// development database can never be reached.
//
// Usage: npm run test:e2e [-- <extra jest arguments>]
import { runWithDisposableDatabase } from './disposable-database.mjs';

runWithDisposableDatabase({
  name: 'E2E tests',
  command: 'npm run test:e2e',
  container: 'b2b-erp-e2e-test',
  database: 'b2b_erp_e2e_test',
  port: process.env.E2E_TEST_DB_PORT ?? '55435',
  jestConfig: 'test/jest-e2e.json',
  marker: 'ERP_E2E_TEST',
  jestArgs: process.argv.slice(2),
});

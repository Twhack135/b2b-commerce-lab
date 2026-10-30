// Runs the integration tests against a disposable PostgreSQL database
// (see test/disposable-database.mjs).
//
// Usage: npm run test:int [-- <extra jest arguments>]
import { runWithDisposableDatabase } from '../disposable-database.mjs';

runWithDisposableDatabase({
  name: 'Integration tests',
  command: 'npm run test:int',
  container: 'b2b-erp-int-test',
  database: 'b2b_erp_int_test',
  port: process.env.INT_TEST_DB_PORT ?? '55433',
  jestConfig: 'test/jest-int.json',
  marker: 'ERP_INTEGRATION_TEST',
  jestArgs: process.argv.slice(2),
});

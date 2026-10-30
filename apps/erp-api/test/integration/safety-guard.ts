// Runs before every integration test file. The integration tests delete
// data, so they must only ever run against the disposable test database
// created by test/integration/run-integration-tests.mjs.
import { checkTestDatabase, developmentDatabaseUrl } from '../database-safety';

checkTestDatabase({
  marker: 'ERP_INTEGRATION_TEST',
  command: 'npm run test:int',
  env: process.env,
  developmentUrl: developmentDatabaseUrl(),
});

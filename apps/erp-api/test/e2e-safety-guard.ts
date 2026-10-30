// Jest globalSetup of the e2e tests: runs once before any test file, after
// all environment variables and .env files have been resolved. The e2e
// tests start the whole application, so they must only ever run against the
// disposable test database created by test/run-e2e-tests.mjs.
import {
  checkConnectedDatabase,
  checkTestDatabase,
  developmentDatabaseUrl,
} from './database-safety';

export default async function e2eSafetyGuard(): Promise<void> {
  const target = checkTestDatabase({
    marker: 'ERP_E2E_TEST',
    command: 'npm run test:e2e',
    env: process.env,
    developmentUrl: developmentDatabaseUrl(),
  });
  await checkConnectedDatabase(process.env.DATABASE_URL!, target);
}

import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

// The .env file lives in the project root, two folders up
process.loadEnvFile(path.join(__dirname, '..', '..', '.env'));

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});

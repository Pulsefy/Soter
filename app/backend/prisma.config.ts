import { closeSync, openSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (process.env.CI === 'true') {
  closeSync(openSync('prisma/test.db', 'a'));
  process.env.DATABASE_URL = 'file:./test.db';
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://soter_user:soter123@localhost:5432/soter_db',
  },
});

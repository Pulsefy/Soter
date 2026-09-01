import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://soter_user:soter123@localhost:5432/soter_db',
    shadowDatabaseUrl:
      process.env.SHADOW_DATABASE_URL ||
      'postgresql://soter_user:soter123@localhost:5432/soter_shadow',
  },
});

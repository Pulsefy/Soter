# Database Migrations

Soter uses **Prisma** with a PostgreSQL backend. `app/backend/prisma/schema.prisma` is the
single source of truth for the data model, and `app/backend/prisma/migrations/` holds the
ordered, applied migration history.

The backend CI (`.github/workflows/backend-ci.yml`) runs a **drift check** that fails the
build whenever the migration history and the schema diverge. This keeps the schema and the
migrations in lockstep so a fresh database built only from migrations matches what the code
expects.

## How the drift check works

```bash
# from app/backend
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema prisma/schema.prisma \
  --exit-code
```

- `--from-migrations` materializes the full schema produced by replaying every migration in
  a scratch (shadow) database.
- `--to-schema` supplies the desired state from `schema.prisma`.
- `--exit-code` makes the command return a non-zero exit code when the two differ, which
  fails the CI job.

The shadow database URL is configured in `app/backend/prisma.config.ts` via
`SHADOW_DATABASE_URL` (defaulting to `soter_shadow`). Prisma requires the shadow database to
exist, so the CI step creates it idempotently before running the diff.

## When you change the data model

Never edit a committed migration or an already-deployed database directly. The schema is the
source of truth; any change to it must be paired with a new migration.

### 1. Edit the schema

Update `app/backend/prisma/schema.prisma` (e.g. add a model, column, index, or enum value).

### 2. Create a migration

With a Postgres instance available locally, run:

```bash
# from app/backend, with DATABASE_URL set to your local database
DATABASE_URL=postgresql://soter_user:soter123@localhost:5432/soter_db \
  npx prisma migrate dev --name <short_description>
```

This generates a new migration directory under `app/backend/prisma/migrations/` (for example
`20260827000000_add_foo/`) and applies it to your local database.

> `prisma migrate dev` allows you to apply the migration to a development database and is
> fine for local work. Deployment and CI apply it with `prisma migrate deploy`, which never
> modifies the schema on its own.

### 3. Verify the drift check passes

Confirm the new migration reconciles the schema exactly:

```bash
# from app/backend
SHADOW_DATABASE_URL=postgresql://soter_user:soter123@localhost:5432/soter_shadow \
  npx prisma migrate diff \
    --from-migrations prisma/migrations \
    --to-schema prisma/schema.prisma \
    --exit-code
```

`No difference detected` (exit code 0) means the schema and migrations are in sync.

### 4. Commit

Commit the schema change together with the generated migration directory so `migrate deploy`
can reproduce the schema on a fresh database. If you forget a migration, CI's drift check
will fail and flag it for you.

## Resolving drift

If the drift check reports a difference you did not intend, inspect the diff summary:

```bash
# from app/backend
SHADOW_DATABASE_URL=postgresql://soter_user:soter123@localhost:5432/soter_shadow \
  npx prisma migrate diff \
    --from-migrations prisma/migrations \
    --to-schema prisma/schema.prisma
```

The output lists the tables/columns Prisma would need to add or change. Either:

- undo the unintended schema edit, or
- create a migration that captures the intended change (step 2 above).

## Running the backend e2e suite against a fresh database

CI does this automatically, but locally you can reproduce it:

```bash
# create a fresh database, then
DATABASE_URL=postgresql://soter_user:soter123@localhost:5432/<fresh_db> \
  npx prisma migrate deploy
pnpm --filter backend run test:e2e
```

Because the drift check guarantees migrations reproduce the schema, a database created only
from migrations passes the e2e suite.

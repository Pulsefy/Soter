## Description

Adds a safe, admin-only backend workflow for migrating deployed AidEscrow contracts. The workflow invokes the on-chain migration, verifies the reported contract version, and updates deployment metadata only after successful verification. It also adds migration tests and an operational runbook covering pre-flight checks, triggering, verification, failure handling, and rollback options.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Breaking change
- [x] Documentation update

## Files Modified

- `app/backend/prisma/schema.prisma`
- `app/backend/prisma/migrations/20260928000000_add_contract_version_to_deployment_metadata/migration.sql`
- `app/backend/src/deployment-metadata/`
- `app/backend/src/onchain/onchain.adapter.ts`
- `app/backend/src/onchain/onchain.adapter.mock.ts`
- `app/backend/src/onchain/soroban.adapter.ts`
- `app/backend/src/onchain/soroban-onchain.adapter.ts`
- `docs/contract-migration-runbook.md`

## Testing

- [x] Tested locally
- [x] Added unit tests
- [ ] Tested on Stellar Testnet (for wallet/contract changes)

## Code Quality checks

- Backend build passed.
- Prisma client generation and schema validation passed.
- Focused migration and adapter tests passed.
- Contract binding regression tests passed.
- Changed-file lint passed with existing warnings only.
- `git diff --check` passed.

# Behavioural Changes

- Adds `POST /api/v1/deployment-metadata/:id/migrate` for admin callers.
- Requires the target version to be greater than the currently reported on-chain version.
- Persists `DeploymentMetadata.contractVersion` only after `get_version()` confirms the requested version.
- Leaves deployment metadata untouched when migration submission or verification fails.

## Related Issues

Closes #

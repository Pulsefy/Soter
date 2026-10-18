# AidEscrow Contract Migration Runbook

This runbook describes the controlled procedure for migrating an initialized
`AidEscrow` deployment with the backend admin endpoint. The endpoint invokes the
contract's admin-only `migrate(new_version)` function, reads `get_version()`
after the transaction, and updates `DeploymentMetadata.contractVersion` only
when the requested version is verified on-chain.

## Preconditions

1. Confirm the target deployment record and contract ID:

   ```text
   GET /api/v1/deployment-metadata/by-contract/{network}/{contractName}
   ```

2. Confirm the backend is configured for the same network as the deployment:
   `SOROBAN_NETWORK`, RPC URL, and network passphrase must agree.
3. Confirm the backend is using the Soroban adapter (`ONCHAIN_ADAPTER=soroban`)
   and has a funded `SOROBAN_ADMIN_SECRET_KEY` for the contract admin.
4. Confirm the target contract WASM and source migration path have been reviewed,
   and that the requested version is greater than the current version.
5. Pause or drain operational writes if the migration changes storage used by
   active requests. Record the current contract version and deployment metadata
   before proceeding.

## Trigger

Use an authenticated admin request. The caller must have the admin role and,
when API-key authentication is used, the `admin` API-key scope.

```http
POST /api/v1/deployment-metadata/{deploymentId}/migrate
Authorization: Bearer <admin-token>
Content-Type: application/json

{"newVersion": 2}
```

The successful response includes:

- `previousVersion`;
- `verifiedVersion`;
- the submitted `transactionHash`; and
- the updated deployment record with `contractVersion`.

Do not update deployment metadata manually before the endpoint completes.
If the transaction fails or the post-transaction `get_version()` value does not
equal `newVersion`, the endpoint fails and metadata remains unchanged.

## Post-flight checks

1. Confirm `verifiedVersion` equals the requested version.
2. Query deployment metadata and confirm `contractVersion` matches:

   ```text
   GET /api/v1/deployment-metadata/by-contract-id/{contractId}
   ```

3. Run the deployment's read-only smoke checks (`get_admin`, aggregates, and a
   representative package read) against the same network.
4. Monitor Soroban transaction status, backend logs, and contract error metrics.
5. Record the migration request, transaction hash, operator, versions, and
   verification time in the deployment change record.

## Failure handling

- A rejected transaction, RPC timeout, or failed simulation does not update
  `DeploymentMetadata`.
- A transaction that confirms but reports the wrong version also does not update
  metadata. Treat this as an incident: preserve the transaction hash and
  inspect the contract state before retrying.
- Do not retry blindly after an unknown confirmation state. Query
  `get_version()` first; if it already equals the target, update metadata only
  through a controlled reconciliation procedure.

## Rollback options

Soroban contract storage changes are not automatically reversible. There is no
generic backend rollback that can undo a confirmed migration.

Choose the least risky corrective action after reviewing the migration:

1. **Forward migration:** deploy a subsequent contract version containing a
   corrective migration and invoke this endpoint for that version.
2. **Application rollback:** roll back backend code only when the migrated
   storage remains compatible with the previous backend.
3. **Redeployment:** for unrecoverable testnet or non-production state, deploy
   a known-good contract, initialize it with the approved admin, and create a
   new deployment metadata record. Preserve the old record for auditability.

Never overwrite the old deployment record or claim a rollback succeeded without
reading and recording the actual on-chain version.

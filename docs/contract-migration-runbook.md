# Contract Migration Runbook

`AidEscrow.migrate(env, new_version)` upgrades on-chain state between contract versions
(`app/onchain/contracts/aid_escrow/src/lib.rs`). Upgrading the WASM and migrating state are two
separate operations, and until now only the reverse-engineered sequence of RPC calls existed.
This runbook documents the supported path: pre-flight checks, the admin trigger, what the
backend verifies, and how to roll back.

The trigger is implemented by `ContractMigrationService` and exposed as
`POST /deployment-metadata/:id/migrate`.

## When to use this

* A release changes the contract's state layout and ships a `migrate` step for it, or
* a `migrate` step exists for a live deployment but has not been applied yet.

Do **not** use it to install new code. The WASM upgrade (`update_current_contract_wasm`) is a
separate, out-of-band operation documented in `docs/testnet-deploy-runbook.md` and registered in
`app/onchain/deployments/registry.json`. Apply the WASM upgrade **first** if the release
includes one.

## Pre-flight checklist

1. **Contract release is merged and green.** The contract crate tests, including
   `app/onchain/contracts/aid_escrow/tests/campaign_token_migration.rs` and
   `upgrade_migration_harness.rs`, pass on the commit being deployed.
2. **The target deployment is the configured contract.** The backend adapter is bound to
   `AID_ESCROW_CONTRACT_ID` and refuses to migrate anything else, so confirm the deployment
   record's `contractId` is that address:
   ```bash
   curl -s "$BACKEND/deployment-metadata/$DEPLOYMENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN"
   ```
3. **Record the currently reported version** — you need it for the guard and for rollback:
   ```bash
   # from the API, or directly from the chain
   psql "$DATABASE_URL" -c "select id, \"contractId\", metadata from \"DeploymentMetadata\" where id = '$DEPLOYMENT_ID';"
   ```
   The version the guard compares against is the contract's `get_version()` (a `u32` state
   version), reported through `GET /deployment-metadata/:id` as `metadata.contractVersion`
   after a migration and read live by the endpoint before it submits anything.
4. **Snapshot the row** so the metadata can be restored verbatim if the release is abandoned:
   ```bash
   psql "$DATABASE_URL" -c "\copy (select * from \"DeploymentMetadata\" where id = '$DEPLOYMENT_ID') to 'deployment-$DEPLOYMENT_ID.json'"
   ```
5. **Admin credentials are in place** — backend `SOROBAN_ADMIN_SECRET_KEY` must be the
   contract admin, and the caller needs the `admin` role.

## Trigger

```http
POST /deployment-metadata/:id/migrate
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "newVersion": 2,
  "expectedCurrentVersion": "1"
}
```

* `newVersion` (required) — the version passed to `migrate`; a positive `u32`.
* `expectedCurrentVersion` (optional, recommended) — pre-flight guard. If the chain does not
  report exactly this version, nothing is submitted. Use it on every retry: it is what makes a
  retry safe after a partially-completed run.

Step by step, the endpoint:

1. loads the `DeploymentMetadata` row for `:id`,
2. reads the version the chain currently reports,
3. applies the `expectedCurrentVersion` guard (if supplied), then rejects a no-op migration when
   the contract already reports `newVersion`,
4. submits `migrate(newVersion)` to the contract, signed by the backend admin key,
5. reads the version again, and requires that it **changed** and **matches** `newVersion`,
6. only then rolls the metadata forward and returns the verified result.

## What gets updated

`recordVerifiedMigration` sets, on the deployment row:

| Field | Value |
| --- | --- |
| `transactionHash` | hash of the `migrate` transaction |
| `metadata.contractVersion` | version the chain reported **after** the migration |
| `metadata.previousContractVersion` | version the chain reported **before** it |
| `metadata.migrationTransactionHash` | same hash, kept next to the versions for provenance |
| `metadata.migratedAt` | ISO-8601 timestamp of the migration |

Existing `metadata` keys are preserved. `deployedAt` and `wasmHash` are deliberately left
alone: a state migration does not by itself prove a new WASM hash was installed, and inventing
one would defeat the point of storing it.

## Failure modes

Every failure below exits before step 6, so the stored metadata still describes the contract as
it was actually observed.

| Symptom | HTTP | Submitted? | Metadata changed? | Action |
| --- | --- | --- | --- | --- |
| Deployment id unknown | 404 | no | no | Fix the id (`GET /deployment-metadata`). |
| `expectedCurrentVersion` does not match the chain | 409 | no | no | Re-read the live version, decide whether someone already migrated, then retry. |
| Contract already reports `newVersion` | 409 | no | no | Nothing to do — the migration is already applied. Reconcile metadata with step 6 if it is missing. |
| Version report unreadable before submitting | 502 | no | no | Check `STELLAR_RPC_URL` / contract id, then retry. |
| Submission rejected (simulation error, auth, contract-id mismatch) | error from adapter | no | no | The message says what failed; contract-id mismatches mean `AID_ESCROW_CONTRACT_ID` and the deployment record disagree. |
| Version unchanged after submitting | 502 | yes | no | The tx hash is in the error. Inspect the transaction on the explorer; if it failed, retry with `expectedCurrentVersion` set to the live version. |
| Version changed but is not `newVersion` | 502 | yes | no | Someone deployed a different version. Reconcile by hand, then run the API's `PUT /deployment-metadata/:id` with the observed values. |
| Version unreadable after submitting | 502 | yes | no | The migration may have succeeded. Read `get_version()` directly, then record the result with `PUT /deployment-metadata/:id`. |

The important property: a 502 never means "metadata says the migration happened". Metadata only
moves on a verified change, so a failed or ambiguous run leaves the API reporting the old state.

## Rollback

**Metadata.** Because the write happens last, a failed migration needs no metadata rollback at
all. To undo a *successful* record (for example you decided to abandon the release), restore the
snapshot from the pre-flight checklist, or:

```http
PUT /deployment-metadata/:id
{ "transactionHash": "<previous hash>", "metadata": { <previous metadata> } }
```

**On-chain state.** `migrate` is forward-only: the contract has no inverse, and the v1→v2 step
(`backfill_campaign_token_totals`) is idempotent and only recomputes totals from the persisted
records, so re-running `migrate(2)` is safe and does not double-count. If the release must be
abandoned:

1. build and deploy the previous WASM through the standard Soroban upgrade path in
   `docs/testnet-deploy-runbook.md`,
2. register the rollback deployment (`POST /deployment-metadata`, or `PUT` the existing row) so
   the API reports the contract you are actually running,
3. do not re-run `migrate` on the rolled-back package unless its own `migrate` step requires it.

Treat state migrations as forward-only and rehearse them on testnet. A rollback of state is a
restore-from-bookkeeping exercise, not a button.

## Idempotency and retries

* Re-running the endpoint after a fully verified migration returns 409 (already at
  `newVersion`) and changes nothing.
* Re-running after a failed submission is safe: nothing was verified, so nothing was recorded.
* Always supply `expectedCurrentVersion` on a retry. It is the guard that turns "did someone
  else already migrate this?" into a 409 instead of a second submission.

## Verifying a migration

```bash
# 1. metadata reflects the new version and the migration tx
curl -s "$BACKEND/deployment-metadata/$DEPLOYMENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN"

# 2. the transaction succeeded on-chain
curl -s "https://horizon-testnet.stellar.org/transactions/<hash>"
```

`app/onchain/scripts/verify-deployment.py` verifies a deployment record against the chain and is
the right tool if you also want the registry entry checked.

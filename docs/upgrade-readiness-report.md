# AidEscrow Upgrade Readiness Report

## Scope

This report is based on the current Soroban contract source and the contract regression tests in the `aid_escrow` package. It summarizes the current storage version, the migration surface, and the event compatibility posture for a release candidate.

## Evidence Summary

### Current storage version

The contract initializes an instance-level version key at `init()` and stores `1u32` on first deployment.

- Source: `app/onchain/contracts/aid_escrow/src/lib.rs`
- Observed behavior:
  - `KEY_VERSION` is defined as `symbol_short!("version")`
  - `init()` writes `KEY_VERSION` = `1`
  - `get_version()` returns the stored value, defaulting to `0` when uninitialized

### Migration entrypoint

The contract includes an admin-only migration function:

- `migrate(env, new_version)` requires admin authentication
- It reads the current version and branches on `(current_version, new_version)`
- The current implementation does not yet perform any storage transformation for the `1 -> 2` path; it only prepares the structure for future logic

### Storage compatibility posture

Current contract storage keys are instance-scoped and include:

- `admin`
- `version`
- `locked`
- `pkg_cnt`
- `config`
- `pkg_idx`
- `dstrbtrs`
- `paused`
- `p_create`
- `p_claim`
- `p_wdrw`
- `claimed`
- `merkle_root` metadata

This means the upgrade risk is primarily around schema evolution of the stored `Config`, `Package`, and aggregate state. Because the migration code is currently a placeholder, any new release that adds fields or changes old storage layouts should be treated as a compatibility review item before deployment.

## Migration Requirements Before Release

1. Confirm the deployed contract storage version is still `1`.
2. If a new release adds or changes `Package` / `Config` shape, implement explicit data transformation in `migrate()`.
3. Preserve the existing `KEY_VERSION` semantics so indexers and operators can tell which migration path was executed.
4. Add a migration regression test that proves the on-chain storage layout is preserved or transformed as intended.
5. Re-run the contract event and versioning suites after any schema change.

## Event Compatibility Review

The contract intentionally emits stable, indexer-friendly topics for lifecycle transitions. The events currently asserted in tests are:

- `escrow_funded`
- `package_created`
- `package_claimed`
- `package_disbursed`
- `package_revoked`
- `package_refunded`
- `extended_event`
- `batch_created_event`
- `surplus_withdrawn_event`
- `contract_paused_event`
- `contract_unpaused_event`
- `action_paused_event`
- `action_unpaused_event`

### Compatibility risk

Changing event names, topic symbols, or payload field names is a breaking compatibility event for downstream indexers or analytics.

The event tests in `tests/events.rs` confirm the expected payload fields for the critical lifecycle operations, including `package_id`, `recipient`, `amount`, `actor`, `old_expires_at`, and `new_expires_at`.

### Positive sign

The existing event model is already designed to be stable and is documented as such in the contract source comments. That is a good foundation for release review, but it also means every event shape change must be treated as a versioned contract change.

## Test Evidence

The repository contains explicit versioning and event tests:

- `app/onchain/contracts/aid_escrow/tests/versioning.rs`
- `app/onchain/contracts/aid_escrow/tests/events.rs`

Observed test coverage:

- `test_version_set_on_init` confirms that initialization writes version `1`
- `test_migrate_version_progression` confirms that `get_version()` can be moved forward through admin-triggered migrations
- `test_escrow_funded_event`, `test_package_created_event`, `test_package_claimed_event`, `test_package_disbursed_event`, `test_package_revoked_event`, `test_package_refunded_event`, and `test_extended_event_records_old_and_new_expiry` validate the key event payload shapes

## Known Compatibility Notes

- The contract package version is reported separately by `contract_version()` and is not the same thing as the stored migration version.
- The current migration implementation is intentionally conservative: it records the new version but does not yet transform storage.
- The design is upgrade-ready only in a minimal sense. It is suitable for additive, non-breaking changes but is not yet a fully automated storage-migration framework.
- A release that changes any public event schema or any persisted data layout should require a contributor review with explicit migration steps.

## Contributor Review Recommendation

Recommended pre-deployment review checklist:

- Confirm the on-chain storage version is still `1` before rollout.
- Confirm no event names or payload fields were renamed in the release branch.
- Confirm any new state field has a corresponding migration branch in `migrate()`.
- Confirm all affected tests still pass after the release candidate is built.
- Confirm downstream indexers and analytics consumers are ready for the published event schema.

## Release Verdict

Status: `Moderate upgrade-readiness risk`

Reason:

- Version key and admin-only migration path exist.
- Event topics are stable and explicitly documented.
- Storage migration logic is present only as a scaffold, with no concrete data transformation yet.
- Any release that touches persisted data shape or event schema should be reviewed as a compatibility release rather than a seamless upgrade.

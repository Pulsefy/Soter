## Description

Wires the contract's two-step admin transfer into the backend so rotating the AidEscrow admin goes through the application's own tooling and leaves an audit trail.

The contract already implemented `transfer_admin` (propose), `accept_admin` (confirm) and `cancel_admin_transfer`, but nothing in the backend could invoke any of them, so rotating the admin meant calling the contract directly with no record of who initiated or accepted it.

`AdminTransferService` mirrors the contract's state machine over the adapter and writes one hash-chained audit entry per leg with the actor, the on-chain timestamp, the transaction hash and the addresses involved. Every write reads contract state back afterwards, so a nomination the contract silently ignored raises 409 instead of being reported as success.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Breaking change
- [ ] Documentation update

## Files Modified

- `app/backend/src/onchain/onchain.adapter.ts`
- `app/backend/src/onchain/soroban.adapter.ts`
- `app/backend/src/onchain/onchain.adapter.mock.ts`
- `app/backend/src/onchain/soroban-onchain.adapter.ts`
- `app/backend/src/onchain/admin-transfer.service.ts` (new)
- `app/backend/src/onchain/admin-transfer.controller.ts` (new)
- `app/backend/src/onchain/dto/admin-transfer.dto.ts` (new)
- `app/backend/src/onchain/onchain.module.ts`
- `app/backend/src/spec-app.module.ts`
- `app/backend/src/onchain/admin-transfer.service.spec.ts` (new)
- `app/backend/src/onchain/admin-transfer.controller.spec.ts` (new)

## Testing

- [x] Tested locally
- [x] Added unit tests
- [ ] Tested on Stellar Testnet (for wallet/contract changes)

## Code Quality checks

- Backend build passed (`nest build`).
- Full backend lint passed: 0 errors, 239 warnings (unchanged, under the 283 cap).
- Full backend suite passed: 111 suites / 1160 tests.
- Changed-file lint clean.
- Contract binding regression tests passed.

# Behavioural Changes

- `OnchainAdapter` gains `getAdminState`, `transferAdmin`, `acceptAdmin` and `cancelAdminTransfer`. Implemented in `SorobanAdapter`, `MockOnchainAdapter` and the legacy `SorobanOnchainAdapter` (the last is unregistered but implements the interface, so the build required it).
- Adds `GET /api/v1/admin/transfer/state`, `POST .../propose`, `POST .../accept` and `POST .../cancel`, all `@Roles(AppRole.admin)`.
- `MockOnchainAdapter` now tracks a real admin / pending-admin pair, so the two-step flow works end to end in mock mode.
- Writes audit entries `admin_transfer_proposed`, `admin_transfer_accepted` and `admin_transfer_cancelled` under entity `AdminTransfer`, keyed by contract ID.
- Accepting or cancelling with no outstanding proposal returns 400; nominating the current admin returns 400.

# Notes for review

- **Role gate.** The issue asked for a super-admin-only endpoint, but this codebase has no such role: `AppRole` is only `admin | operator | client | ngo`, and `admin` is already the highest tier (it gates 36 routes, including `/admin/ledger` and the audit chain operations). Reusing `AppRole.admin` avoids a Prisma enum migration and regenerating the client. Happy to add a real `super_admin` tier as a follow-up if the distinction is actually wanted.
- **Cancel was added beyond the stated AC.** The contract exposes `cancel_admin_transfer`, and the test criterion requires covering propose-then-cancel, so `cancelAdminTransfer` and the `/cancel` endpoint are implemented rather than testing a 404.
- **Params objects, not positional args.** The AC wrote `transferAdmin(newAdmin)` / `acceptAdmin()`; the interface is uniformly params-object based, so `transferAdmin({ newAdminAddress })` was used for consistency and to give the optional `contractId` a home.
- **All endpoints target the configured contract.** An earlier draft let `propose` take a `contractId` override while `accept`/`cancel` did not, so a transfer proposed against an override could never be accepted. The override was removed from the HTTP surface; the adapter still accepts an optional `contractId` for parity with `migrateContract`.
- **Acceptance depends on the signing key.** The contract requires the nominee's auth, and the adapter signs with `SOROBAN_ADMIN_SECRET_KEY`, so `/accept` only succeeds while the backend controls the pending admin. Documented on the endpoint and the service.
- **Audit ordering.** The audit entry is written after the on-chain write is confirmed, and a failed audit write is surfaced rather than swallowed. A caller that sees a 5xx should re-read `/state` to see whether the leg landed; the two-step design makes that recoverable.

## Known Issues (pre-existing, not introduced here)

- `app/backend/openapi/openapi.json` still has an empty `paths` object and has not been regenerated. `createSwaggerDocument` hangs indefinitely in an environment without Postgres/Redis, so the spec could not be produced here; hand-editing a 0-path artifact to add these four routes would make the CI `spec:check` drift comparison worse rather than better. `AdminTransferController` **is** wired into `SpecAppModule` alongside the other 36 controllers, so a regeneration in a DB-backed environment will include these routes. Worth confirming whether `spec:check` is currently green on `main`.
- The lockfile resolves TypeScript 6.0.3, which enables `strictPropertyInitialization` by default against a `tsconfig.json` written for TS 5.x, producing ~213 `TS2564` errors across existing DTOs. The new DTO follows the established convention and adds no new class of error, but `tsc --noEmit` cannot currently be used as a gate.

## Related Issues

Closes #1192

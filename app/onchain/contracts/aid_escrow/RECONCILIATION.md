# Ledger Reconciliation and Drift Detection

This document specifies how an off-chain backend keeps its cached view of
`aid_escrow` state consistent with the authoritative on-chain ledger, how it
detects and records divergence ("drift"), and how an operator triggers a
reconciliation pass on demand.

The on-chain contract is the **single source of truth**. The backend cache is a
performance and query convenience only; whenever the two disagree, the ledger
wins and the cache is corrected.

## Scope

Reconciliation covers the two pieces of state that most directly affect user
funds and are most likely to drift during Testnet operation:

1. **Package statuses** — each package's lifecycle state
   (Created -> Claimed, Expired, Cancelled, or Refunded).
2. **Locked totals** — the amount the contract considers locked per token,
   versus the contract's actual token balance and the backend's own tally.

Everything reconciled here is already exposed by read-only contract views, so a
reconciliation pass performs **no state-changing transactions**.

## On-chain read surface

Reconciliation relies only on existing read-only entrypoints in
`contracts/aid_escrow/src/lib.rs`:

- `get_package(id)` — returns the full `Package` (id, recipient, amount, token,
  status, timestamps). Used to reconcile per-package status and amount.
- `view_package_status(id)` — returns the `PackageStatus` only (cheap poll).
  Used for a fast status-only sweep.
- `get_aggregates(token)` — returns
  `Aggregates { total_committed, total_claimed, total_expired_cancelled }`.
  Used to reconcile locked / committed totals per token.

The `PackageStatus` enum values are stable and ordered:
`Created = 0`, `Claimed = 1`, `Expired = 2`, `Cancelled = 3`, `Refunded = 4`.

Note that `get_aggregates.total_committed` is the sum of `amount` over packages
still in `Created` status, which is the contract's notion of **currently locked**
funds for that token (packages leave `total_committed` once claimed, expired,
cancelled, or refunded).

## Reconciliation model

A reconciliation pass compares three numbers per token and one status per
package:

1. **On-chain committed** — `get_aggregates(token).total_committed`.
2. **Backend committed** — the backend's own sum of cached `Created` package
   amounts for that token.
3. **On-chain token balance** — the SAC balance of the contract address for
   that token (queried via the token contract's `balance`).

Invariants the pass asserts:

- `backend_committed == on_chain_committed` for every token. Any difference is a
  **locked-total drift**.
- `on_chain_balance >= on_chain_committed` for every token. A balance below the
  committed total is a **solvency drift** (should be impossible given the
  contract's solvency check on `create_package`, so it is flagged as critical).
- For every package the backend has cached, `cached.status == on_chain.status`.
  Any difference is a **status drift**.

## Drift incident record

Each detected divergence is persisted as an immutable drift incident. Suggested
schema (backend storage, not on-chain):

- `incident_id` (string, uuid): stable primary key for the incident.
- `kind` (enum): `status_drift`, `locked_total_drift`, or `solvency_drift`.
- `token` (string, address): token the incident relates to (null for a pure
  package-status incident).
- `package_id` (integer or null): package involved, for `status_drift`.
- `expected` (string): on-chain (authoritative) value at detection time.
- `observed` (string): cached (backend) value at detection time.
- `detected_at` (string, ISO-8601): wall-clock time the pass observed the drift.
- `ledger_seq` (integer or null): ledger sequence the on-chain read was taken
  at, when available.
- `resolved_at` (string or null): when the cache was corrected; null while open.
- `resolution` (string or null): `cache_corrected`, `false_positive`, or
  `manual`.

Incidents are append-only; resolving one sets `resolved_at`/`resolution` rather
than mutating the original observation. This preserves an audit trail of every
divergence seen during Testnet.

## Reconciliation pass (algorithm)

The pass is expressed below as pseudocode (indented block):

    for token in tracked_tokens:
        on_chain = get_aggregates(token)
        backend  = backend_committed_sum(token)
        balance  = token_balance(contract_address, token)

        if backend != on_chain.total_committed:
            record_incident(locked_total_drift, token,
                            expected=on_chain.total_committed, observed=backend)
        if balance < on_chain.total_committed:
            record_incident(solvency_drift, token,
                            expected=on_chain.total_committed, observed=balance)

    for pkg in backend_cached_packages():
        on_chain_status = view_package_status(pkg_id)
        if pkg_status != on_chain_status:
            record_incident(status_drift, pkg_token, package_id=pkg_id,
                            expected=on_chain_status, observed=pkg_status)
            correct_cache(pkg_id, on_chain_status)

The pass is **idempotent**: re-running it after a clean pass records no new
incidents. Cache corrections are applied immediately for status drift; total
and solvency drift are surfaced for operator review because they usually signal
a deeper indexing bug rather than a stale row.

## Scheduling and the on-demand trigger

- **Periodic:** the backend runs the pass on a fixed interval (for Testnet a
  short interval such as every few minutes is appropriate; the interval is a
  configuration value, not hard-coded).
- **On-demand:** an admin-only endpoint triggers a pass immediately and returns
  a summary of the incidents opened during that run.

Suggested admin endpoint (indented block):

    POST /admin/reconcile
      auth:  admin bearer token (same admin identity the contract recognizes)
      body:  { "tokens": ["<token address>", ...] or null }   # null = all tracked
      200:   { "ran_at": "<ISO-8601>",
               "checked_packages": <n>,
               "incidents_opened": <n>,
               "incidents": [ { "incident_id": "...", "kind": "..." } ] }

The endpoint is read-and-correct only: it never submits a ledger transaction, so
it is safe to call at any time and cannot itself move funds.

## Testing guidance

Because the pass depends only on read-only views, it can be tested against a
local Soroban test harness or a Testnet deployment without risking funds:

1. Create packages, then mutate the backend cache directly to simulate each
   drift kind and assert the matching incident is opened.
2. Assert a clean pass (cache in sync) opens zero incidents and is idempotent.
3. Assert `status_drift` auto-corrects the cache while `locked_total_drift` and
   `solvency_drift` remain open for review.

## Relationship to events

The event stream (see `EVENTS.md`) is the primary, low-latency way the backend
keeps its cache fresh. Reconciliation is the **safety net** that catches missed
or mis-applied events (dropped subscriptions, reorgs, indexing bugs) by
periodically comparing the derived cache against authoritative contract reads.

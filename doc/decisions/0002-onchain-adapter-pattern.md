# 0002 — On-chain adapter pattern

- **Status:** Accepted
- **Date / context:** Recorded 2026-09-28 (Wave 9), documenting a decision made
  as the Soroban integration and its tests were built out.

## Decision

On-chain interaction goes through an adapter interface
(`app/backend/src/onchain/onchain.adapter.ts`) with concrete implementations:
a Soroban adapter (`soroban-onchain.adapter.ts` / `soroban.adapter.ts`) for
real network calls and a mock adapter (`onchain.adapter.mock.ts`) for tests and
demos. Services depend on the adapter interface, not on the Stellar/Soroban SDK.

## Alternatives considered

- **Call the Soroban SDK directly from services.** Rejected: it couples
  orchestration logic to the chain client, makes unit tests require a network or
  heavy stubbing, and makes deterministic demos/CI hard.
- **A single adapter with internal `if (testnet)` branching.** Rejected: it
  mixes real and mock code paths in one class, which is harder to reason about
  and to keep the mock faithful.

## Consequences

- Tests and demos run against the mock adapter deterministically, with no live
  network (see `onchain.adapter.mock.spec.ts`).
- Real vs mock behavior is selected by configuration/wiring, keeping each
  implementation focused.
- New chain operations are added to the interface once and implemented in each
  adapter.

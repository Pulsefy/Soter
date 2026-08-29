# Gas Profiling Report: Core Escrow Flows

**Issue:** Establish a baseline gas profile for core flows and identify top 3 optimization targets (if needed)  
**Date:** 2026-06-27  
**Contract:** `aid_escrow` (Soroban SDK v23)

## Scope

This baseline report covers the requested core flows:

- `create_package`
- `claim`
- `refund`

No functional contract behavior was changed to deliver this baseline.

## What Was Added

A dedicated profiling test suite now includes a refund benchmark in addition to the existing create and claim coverage:

- `profile_single_create_package`
- `profile_single_claim`
- `profile_single_refund`

Supporting profiling coverage for batch create, claim with Merkle proof, funding, and read paths remains available for broader analysis.

## Methodology

The profiling suite uses Soroban test budget counters:

- CPU instructions via `env.cost_estimate().budget().cpu_instruction_cost()`
- Memory bytes via `env.cost_estimate().budget().memory_bytes_cost()`

Each test:

1. Sets up a fresh contract + token environment.
2. Prepares only the state required for the target flow.
3. Captures budget immediately before the target operation.
4. Executes the operation.
5. Captures budget after execution.
6. Reports the delta as the baseline cost for that flow.

### Run Command

```bash
cd app/onchain
cargo test --package aid_escrow --test gas_profiling -- --nocapture
```

## Core Flow Baseline Results

> Note: Exact values depend on Soroban SDK/runtime version and local toolchain. The suite is now the source of truth for regenerating these baselines.

| Flow | Coverage Status | Notes |
|---|---|---|
| `create_package` | Baseline test present | Measures isolated single-package creation cost |
| `claim` | Baseline test present | Measures direct recipient claim cost |
| `refund` | Baseline test present | Measures admin refund of an expired package |

## Refund Flow Notes

The new refund benchmark profiles the realistic path required by current contract semantics:

1. Fund contract
2. Create package
3. Advance ledger past expiry
4. Call `refund`

This captures the full refund transition cost, including:

- package load/update
- expired-state handling
- token transfer back to admin
- locked-funds bookkeeping
- refund event emission

## Top 3 Optimization Targets

This issue only required baseline profiling, so no behavior changes were introduced. Based on the contract structure and existing profiling coverage, the main optimization candidates are:

### 1. Repeated storage writes in package lifecycle flows
Create, claim, and refund all perform multiple instance/persistent storage reads and writes.

Potential future focus:
- reduce repeated map loads/stores where safe
- consolidate bookkeeping updates
- avoid redundant persistence operations

### 2. Per-package event emission overhead in batch creation
Batch creation emits one `PackageCreated` event per package plus a batch event.

Potential future focus:
- evaluate whether all per-package events are required
- consider alternate indexing/event strategies if resource pressure appears on testnet

### 3. Aggregate and index maintenance strategy
The contract maintains counters and package indexes for later scans.

Potential future focus:
- reduce write amplification for indexing
- consider more direct aggregate accounting for heavily-used read paths
- evaluate recipient-specific indexing if dashboard queries become expensive

## CI Regression Gate (Budgets)

Profiling alone does not stop a pull request from making a hot path materially
more expensive. A committed budget file now acts as the gate:

- `gas_budgets.json` — the source of truth for allowed costs per entry point.
  Each entry lists `cpu_instructions` and `memory_bytes` ceilings, plus a
  `tolerance` (default ±15%) that absorbs normal measurement noise.
- `tests/gas_profiling.rs` — every profiling test now records its measured
  cost to `target/gas_metrics/<operation>.json` (machine-readable).
- `scripts/check_gas_budgets.py` — the CI gate. It reads the budgets and the
  recorded metrics, compares them, and **fails the build** when any measured
  cost exceeds its budget beyond tolerance. The failure message names the
  entry point and the CPU/memory delta vs budget so the regression is
  actionable.

### How a regression is caught

1. A PR changes contract logic, making `claim` ~30% more expensive.
2. The gate step runs `cargo test --test gas_profiling` (producing the metrics)
   then `python3 scripts/check_gas_budgets.py`.
3. The script prints `[REGRESSION] claim` with the CPU/Memory delta and exits
   non-zero, failing the `Contract CI` job.

### Tolerating noise

Budgets are deterministic (Soroban meters guest VM instructions, not wall
clock), so the same code yields the same numbers across machines. The
`tolerance` band still permits minor runtime variance without a false failure.

### Updating a budget deliberately

Budgets are only changed in a reviewed commit. To refresh a baseline after an
intentional, approved cost change:

```bash
cd app/onchain
SOTER_UPDATE_GAS_BUDGETS=1 cargo test --test gas_profiling
# review the diff in contracts/aid_escrow/gas_budgets.json, then commit it
```

### Re-running the gate locally

```bash
cd app/onchain
cargo test --test gas_profiling -- --nocapture
python3 scripts/check_gas_budgets.py
```

## Validation Summary

- Baseline profiling now explicitly covers **create / claim / refund** as requested.
- No functional escrow behavior was changed.
- The change is isolated to profiling/reporting artifacts.

## Files Updated

- `app/onchain/contracts/aid_escrow/tests/gas_profiling.rs` (records metrics)
- `app/onchain/contracts/aid_escrow/gas_budgets.json` (committed budgets + tolerance)
- `app/onchain/scripts/check_gas_budgets.py` (CI regression gate)
- `.github/workflows/contract-ci.yml` (gate step + metrics artifact upload)
- `app/onchain/contracts/aid_escrow/GAS_PROFILING_REPORT.md`

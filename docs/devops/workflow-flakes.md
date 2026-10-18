# Workflow Flakes vs Real Failures

## Definitions

- **Real failure**: A deterministic issue in the workflow definition, repository code, or dependencies that fails consistently under the same conditions. Requires code or YAML changes.
- **Flake (intermittent failure)**: A non-deterministic failure caused by transient external conditions — network hiccups, testnet RPC latency, rate limits, resource contention on shared runners, or seed-dependent race conditions. Passes on retry with no code change.

## Root Cause of testnet-smoke failures

The testnet-smoke workflow historically failed or risked failure for these reasons:

1. **No `timeout-minutes` guard (real failure)**. Long-running network tests against the testnet RPC could hang indefinitely, wasting CI quota and eventually failing with a runner kill.

2. **Testnet RPC latency and rate limits (flake)**. Public testnet endpoints (`https://soroban-testnet.stellar.org`) are shared and rate-limited. Steps that submit transactions or poll for confirmations can time out under load even when the implementation is correct. These are marked `continue-on-error: true` so they don't block other steps and the workflow outcome reflects the code, not the network.

3. **npm registry transient failures (flake)**. On shared runners, `npm ci` can hit ECONNRESET or ETIMEDOUT reaching registry.npmjs.org. Retrying the same commit usually passes.

## How to classify a new failure

1. Re-run the exact same workflow once via the GitHub UI (Actions → select the run → Re-run all jobs).
   - If it passes on re-run with zero changes: it's a flake.
   - If it fails the same way twice: it's a real failure.
2. Inspect the failing step's log.
   - Errors containing `ECONNRESET`, `ETIMEDOUT`, `5xx`, `rate limit`, `too many requests`, `ENOTFOUND`, or `socket hang up` are almost always flakes.
   - Errors containing `SyntaxError`, `ENOENT`, `command not found`, `TypeError`, `YAML syntax`, `exit status 1` from a test assertion, or a lint/type-check failure are real failures.
3. For flakes: add `continue-on-error: true` with a trailing comment explaining the flake source, and consider increasing `timeout-minutes` or adding a retry wrapper (`npx retry-cli` or a bash for-loop) at the step level.
4. For real failures: fix the underlying code or YAML and add a regression test.

## Maintenance cadence

- After each batch of flake markings, review whether the affected step should use a cached dependency (`actions/cache` for node_modules / target), local mock against the `SOROBAN_RPC_URL` fallback, or retry wrapper instead of `continue-on-error`.
- Every quarter: audit flake steps to confirm they are still needed. Remove `continue-on-error` once the underlying service stabilizes or a retry wrapper is added.
- Never mark compile/type-check/lint steps as continue-on-error. Those must always be deterministic gatekeepers.

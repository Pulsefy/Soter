# Deployment Registry

This folder is the single source of truth for on-chain **AidEscrow** deployments.
It records every deployed contract, the exact build it came from, and the
configuration used to initialize it, so that the backend, frontend, mobile, CI,
and contributors can all resolve the current (and historical) contract IDs from
one place.

## Files

| File                    | Purpose                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `registry.json`         | Machine-readable index of all deployments (one entry per deploy).                              |
| `registry.schema.json`  | JSON Schema (draft 2020-12) that `registry.json` must satisfy.                                 |
| `testnet-YYYY-MM-DD.md` | Human-readable record for a single deployment (tx hashes, verification steps, explorer links). |

`registry.json` is the authoritative, parseable list. Each entry links to its
detailed `record` markdown for the full deploy narrative.

## Registry format

Each object in the `deployments` array has this shape (see `registry.schema.json`
for the authoritative rules):

    {
      "network": "testnet",
      "version": "0.1.0",
      "contract_id": "C...",
      "wasm_hash": "<64 hex chars>",
      "deployer": "G...",
      "init_args": { "admin": "G..." },
      "deployed_at": "2026-06-03",
      "git_commit": "<source commit sha or null>",
      "version_tag": "v0.1.0-testnet",
      "record": "deployments/testnet-2026-06-03.md"
    }

### Field reference

| Field         | Type           | Description                                                                                        |
| ------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| `network`     | string         | `testnet`, `futurenet`, or `mainnet`.                                                              |
| `version`     | string         | Contract crate version (`Cargo.toml`), e.g. `0.1.0`.                                               |
| `contract_id` | string         | Deployed contract ID (56-char `C...` strkey).                                                      |
| `wasm_hash`   | string         | SHA-256 of the uploaded WASM (64 hex chars).                                                       |
| `deployer`    | string         | Public key that uploaded and created the contract.                                                 |
| `init_args`   | object         | Arguments passed to `init()`. Must include `admin`.                                                |
| `deployed_at` | string         | Deploy date (`YYYY-MM-DD`) or ISO-8601 timestamp.                                                  |
| `git_commit`  | string \| null | Source commit the build came from. `null` only for legacy entries recorded before commit tracking. |
| `version_tag` | string         | Git release tag, e.g. `v0.1.0-testnet`.                                                            |
| `record`      | string         | Path (relative to `app/onchain`) to the detailed record markdown.                                  |

Entries are ordered oldest to newest; the **last** entry is the current
deployment.

## Adding a new deployment entry

After you deploy (follow the testnet deploy runbook at
`../DEPLOY_TESTNET_RUNBOOK.md`), append a new object to the `deployments` array.
Gather the values like this:

1. `contract_id` — printed by `make deploy` / `deploy.sh` (also saved to `.env`).
2. `wasm_hash` — run `sha256sum target/wasm32v1-none/release/aid_escrow.wasm`.
3. `deployer` — run `soroban keys address "$SECRET_KEY"`.
4. `init_args.admin` — the `--admin` value passed to `initialize.sh`.
5. `git_commit` — the exact source commit you built from: `git rev-parse HEAD`.
6. `deployed_at` — today's date (`date +%F`) or a full ISO-8601 timestamp.
7. `version` and `version_tag` — the crate version and its git tag.
8. `record` — create `deployments/testnet-YYYY-MM-DD.md` for the full narrative
   and point `record` at it.

## Validating the registry

The registry should always satisfy `registry.schema.json`. Validate it locally
with any JSON Schema validator, for example:

    npx ajv-cli validate -s app/onchain/deployments/registry.schema.json -d app/onchain/deployments/registry.json --spec=draft2020

Many editors (VS Code) validate automatically thanks to the `$schema` reference
at the top of `registry.json`.

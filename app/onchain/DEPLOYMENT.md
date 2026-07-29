# Contract Deployment & Maintenance Guide

This is the operational runbook for shipping changes to the `aid_escrow` Soroban
contract: building, validating, deploying, recording the deployment in the
registry, rolling back, and updating the backend/mobile/frontend consumers
safely. It complements the existing docs rather than replacing them:

- [`contracts/aid_escrow/README.md`](contracts/aid_escrow/README.md) — contract
  behavior, invariants, event schema, method reference.
- [`contracts/aid_escrow/VERSIONING.md`](contracts/aid_escrow/VERSIONING.md) —
  the in-contract `get_version()` / `migrate()` mechanism.
- [`../backend/src/onchain/SOROBAN_INTEGRATION.md`](../backend/src/onchain/SOROBAN_INTEGRATION.md)
  — backend adapter architecture.
- [`REGISTRY.md`](REGISTRY.md) — the append-only log of every deployed contract
  ID, referenced throughout this guide.

If you only need to *call* an already-deployed contract (create a package,
claim, inspect state), see the "Testnet invoke scripts" section of
`contracts/aid_escrow/README.md` — that's not repeated here.

---

## 1. Prerequisites

```bash
rustup target add wasm32-unknown-unknown
cargo install --locked soroban-cli   # provides the `soroban` binary used below
```

Copy `app/onchain/.env.example` to `app/onchain/.env` and fill in:

| Var | Purpose |
| --- | --- |
| `NETWORK` | `testnet` \| `futurenet` \| `standalone`. Read by `scripts/deploy.sh`. |
| `SECRET_KEY` / `DEPLOYER_SECRET_KEY` | Signing key for the deploy transaction. `deploy.sh` accepts either; `SECRET_KEY` wins if both are set. **Never commit this file.** |
| `TESTNET_RPC_URL` / `FUTURENET_RPC_URL` / `STANDALONE_RPC_URL` | RPC endpoint overrides. Each has a public default baked into `deploy.sh` and `testnet-invoke.sh`, so these are optional unless you're pointing at a private RPC node. |
| `CONTRACT_NAME` | Defaults to `aid_escrow`. Only change this if you add a second contract package under `contracts/`. |
| `CONTRACT_ID` | **Not** something you set by hand — `scripts/deploy.sh` appends/updates this line in `.env` automatically after a successful deploy (see §3). It's also read directly by `scripts/testnet-invoke.sh` and `scripts/query.sh`. |

`app/onchain/.env` is local tooling config only — it is never read by the
backend, mobile, or frontend apps. Each of those has its own env file (§6).

---

## 2. Build

> **Known gap:** `Makefile`'s `build` target and `deploy.sh`'s error message
> both point at `./scripts/build.sh`, which does not exist in this repo. Use
> the commands below directly until that script is added back — do not run
> `make build`.

From `app/onchain/`:

```bash
# Debug/dev build (fast, for local iteration — not for deployment)
cargo build --target wasm32-unknown-unknown

# Release build (what you actually deploy)
cargo build --release --target wasm32-unknown-unknown
```

This produces:

```
app/onchain/target/wasm32-unknown-unknown/release/aid_escrow.wasm
```

`scripts/deploy.sh` hard-requires this exact path (`$CONTRACT_NAME.wasm` under
`target/wasm32-unknown-unknown/release/`) — if `CONTRACT_NAME` in `.env`
differs from the crate name, the deploy step will report "Contract not
built" even though the wasm exists under a different name.

Release-profile settings (`opt-level = "z"`, `lto = true`, `panic = "abort"`,
`codegen-units = 1`, `strip = "symbols"`) are already configured in the
workspace `Cargo.toml` — you don't need extra optimization flags for a normal
build. If you want an additional size pass, `soroban contract optimize` can be
run against the built wasm and produces a `*.optimized.wasm` file; check the
size delta but don't skip the validation in §3 for the optimized artifact too,
since optimization can (rarely) change behavior at the margins.

---

## 3. Validate the Wasm artifact before deploying

Do all of this **before** running `deploy.sh`. None of it is enforced by CI
today — `contract-ci.yml` only runs `cargo fmt --check`, `cargo clippy` (both
wasm and native targets), and `cargo test` on every push/PR touching
`app/onchain/**`. It does **not** build a release wasm, does not run
`soroban contract optimize`, and does not deploy anything. Treat the steps
below as the pre-deploy checklist a human runs, not something CI covers for
you.

1. **Tests pass on the exact commit you're deploying.**
   ```bash
   cargo test -- --nocapture
   ```
   All suites in `contracts/aid_escrow/tests/` (`core_flow_tests`,
   `integration`, `invariant_tests`, `aggregates`, `batch`, `events`,
   `versioning`, `view_status`, `withdraw_surplus`) must pass. If you bumped
   the contract version, `versioning.rs` should cover the new
   `(old_version, new_version)` migration path — see `VERSIONING.md`.

2. **Lint clean, on both targets** (matches CI exactly, so you find failures
   before pushing rather than after):
   ```bash
   cargo fmt --all -- --check
   cargo clippy --target wasm32-unknown-unknown -- -D warnings
   cargo clippy --tests --target x86_64-unknown-linux-gnu -- -D warnings
   ```

3. **Confirm the wasm was actually rebuilt from the commit you think it was.**
   There's no reproducible-build tooling wired up yet, so the manual
   substitute is: `cargo clean && cargo build --release --target
   wasm32-unknown-unknown` on a clean checkout of the target commit, then hash
   the artifact:
   ```bash
   sha256sum target/wasm32-unknown-unknown/release/aid_escrow.wasm
   ```
   Record that hash in the registry entry (§4) — it's the only durable link
   between "the contract ID on-chain" and "the source commit that produced
   it," since Soroban doesn't expose source verification itself.

4. **Inspect the deployed interface shape before you route real traffic to
   it.** After deploying (§5) but before flipping any consumer's
   `ONCHAIN_ADAPTER`/contract-ID env var to point at it:
   ```bash
   soroban contract invoke --id <CONTRACT_ID> --network <network> --rpc-url <rpc> -- get_admin
   ```
   and a couple of the read-only methods (`get_package`, `view_package_status`,
   `get_aggregates` — see the Method Reference table in
   `contracts/aid_escrow/README.md`) to confirm the contract responds and the
   admin address is what you expect. This catches "deployed the wrong wasm" or
   "initialized with the wrong admin key" before any consumer touches it.

5. **Smoke test the full lifecycle on testnet** using
   `scripts/testnet-invoke.sh` (see `contracts/aid_escrow/README.md` for the
   full command list): `initialize` → `create-package` → `claim` →
   `get-package`/`view-status`. Do this against every new deployment,
   including ones that only change internal logic — the event schema and
   method signatures are the contract's public API and a passing test suite
   doesn't guarantee the *deployed* wasm behaves the same as `cargo test`
   (different opt level, no debug assertions, etc).

---

## 4. Deploy

```bash
cd app/onchain
./scripts/deploy.sh --network testnet             # or futurenet / standalone
# or: ./scripts/deploy.sh --network testnet --contract aid_escrow
```

What it does (`scripts/deploy.sh`):
- Sources `app/onchain/.env` if present.
- Defaults `NETWORK=testnet`, `CONTRACT_NAME=aid_escrow`.
- Resolves the RPC URL for the chosen network (public defaults if no
  `*_RPC_URL` override is set).
- Requires `SECRET_KEY` or `DEPLOYER_SECRET_KEY` — aborts otherwise.
- Requires the wasm to already exist at
  `target/wasm32-unknown-unknown/release/<CONTRACT_NAME>.wasm` (§2) — aborts
  otherwise.
- Runs `soroban contract deploy --wasm ... --source ... --network ... --rpc-url ...`.
- Parses `Contract ID: ...` from the CLI output.
- **Writes `CONTRACT_ID=<new id>` into `app/onchain/.env`** (updates the line
  if it exists, appends it otherwise) — this file is local tooling config, not
  a registry entry, so this auto-write is a convenience for immediately
  running `testnet-invoke.sh`/`query.sh` next, not a substitute for §5.

A fresh deployment is **uninitialized** — you must call `initialize` before
anything else works:

```bash
./scripts/testnet-invoke.sh initialize --admin <ADMIN_STELLAR_ADDRESS>
```

Deploying does not migrate any state from a previous contract ID. There is no
"redeploy the same contract" operation in Soroban — a new deploy always
produces a brand-new contract ID with empty storage. If you need continuity
of funds/packages from an old contract, that is a manual, contract-specific
migration you plan and execute deliberately (out of scope for this doc — file
it as its own change with its own review).

---

## 5. Record the deployment in the registry

**Every** deployment that any consumer (backend, mobile, or a shared testnet
environment) will point at — not just mainnet — gets a row in
[`REGISTRY.md`](REGISTRY.md). This is the single source of truth for "what
contract ID is live where, and what's it built from." Do this immediately
after §3's post-deploy checks pass, before you touch any consumer's env vars.

Append a row with:

| Field | Where it comes from |
| --- | --- |
| Date (UTC) | `date -u +%Y-%m-%d` |
| Network | `testnet` / `futurenet` / `mainnet` |
| Contract ID | Printed by `deploy.sh`, also now in `app/onchain/.env` |
| Wasm SHA-256 | From §3 step 3 |
| Source commit | `git rev-parse HEAD` on the checkout you built from |
| Contract version | The value `get_version()` returns post-deploy (see `VERSIONING.md`) |
| Deployed by | Your name/handle |
| Status | `active` / `superseded` / `paused` |
| Notes | Why (feature release, hotfix, migration), and which consumers were pointed at it and when |

Never edit or delete a historical row — if a deployment is replaced, add a new
row and change the old row's Status to `superseded`, with a note pointing at
the row that replaces it. The registry is append-only so it can answer "what
was live on 2026-04-03" months later.

---

## 6. Update backend/mobile/frontend consumers safely

### 6.1 What each consumer actually reads

| Consumer | File | Vars | Required? |
| --- | --- | --- | --- |
| Backend (NestJS) | `app/backend/.env` | `ONCHAIN_ADAPTER` (`mock` \| `soroban`, default `mock` if unset — see `onchain.module.ts`'s `createOnchainAdapter`), `SOROBAN_CONTRACT_ID`, `STELLAR_RPC_URL` (default `https://soroban-testnet.stellar.org`), `STELLAR_NETWORK_PASSPHRASE` (default `Test SDF Network ; September 2015`) | `SOROBAN_CONTRACT_ID` is required only when `ONCHAIN_ADAPTER=soroban`; `SorobanAdapter` logs a warning and won't function without it (`soroban.adapter.ts`). With `ONCHAIN_ADAPTER=mock` (the default) none of the Soroban vars matter. |
| Mobile (Expo) | `app/mobile/.env` | `EXPO_PUBLIC_SOROBAN_CONTRACT_ID`, `EXPO_PUBLIC_NETWORK` (`testnet` \| `mainnet`), `EXPO_PUBLIC_WALLETCONNECT_STELLAR_CHAIN_ID` (defaults to `stellar:testnet`/`stellar:mainnet` from `EXPO_PUBLIC_NETWORK` if unset) | Read in `app/mobile/src/config/index.ts`. Missing `EXPO_PUBLIC_SOROBAN_CONTRACT_ID` only logs a console warning today, it doesn't hard-fail — don't rely on that as a safety net when rotating IDs. |
| Frontend (Next.js) | — | `NEXT_PUBLIC_STELLAR_NETWORK` / `NEXT_PUBLIC_NETWORK` (network label only), `NEXT_PUBLIC_ENV_NAME` | The frontend does **not** currently read a contract ID env var anywhere in source (only `app/frontend/src/lib/env.ts` reads network/env-name vars, and `WalletConnect.tsx`/`stellarUtils.ts` use `@stellar/freighter-api` purely for wallet connect + signing). It reaches contract state through the backend API, so a contract-ID rotation on backend/mobile does **not** require a frontend change. If you add direct Soroban RPC calls from the frontend in the future, wire the contract ID through a real `NEXT_PUBLIC_*` var and update this table — don't trust `app/frontend/README.md`/`CONTRIBUTING.md`, which currently document five `NEXT_PUBLIC_*` Stellar vars (`NEXT_PUBLIC_STELLAR_HORIZON_URL`, `NEXT_PUBLIC_STELLAR_SOROBAN_RPC_URL`, `NEXT_PUBLIC_AID_ESCROW_CONTRACT_ID`, `NEXT_PUBLIC_VERIFICATION_CONTRACT_ID`) that no code actually reads. |

There is a second, unused backend adapter file,
`app/backend/src/onchain/soroban-onchain.adapter.ts`, which reads a different
set of names (`SOROBAN_RPC_URL`, `SOROBAN_CONTRACT_ID`, `SOROBAN_SECRET_KEY`,
`STELLAR_NETWORK`) and talks to the RPC over raw JSON-RPC instead of the
Stellar SDK. It is **not** wired into `onchain.module.ts`'s adapter factory —
only `soroban.adapter.ts` (`SorobanAdapter`) is live. Ignore the other file's
env vars; if you're not sure which adapter is active, check
`ONCHAIN_ADAPTER` and `createOnchainAdapter` in `onchain.module.ts`.

### 6.2 Rollout order

Contract-ID changes fan out to processes with very different deploy latency —
sequence around that, slowest first isn't right either; go **safest-to-revert
first**:

1. **Backend first, adapter still on `mock` or pointed at the old contract
   ID.** Deploy the backend with the *new* `SOROBAN_CONTRACT_ID` set but keep
   `ONCHAIN_ADAPTER=mock` (or leave the old ID in place) until you're ready to
   cut over — this decouples "backend process restarted with new config" from
   "traffic actually hits the new contract."
2. **Flip `ONCHAIN_ADAPTER=soroban` / update `SOROBAN_CONTRACT_ID` to the new
   ID** on the backend and restart/redeploy it. Both vars are read once in
   `SorobanAdapter`'s constructor — there is no hot-reload, a process restart
   is required for a change to take effect.
3. **Verify** against the live backend (hit the read-only endpoints described
   in `SOROBAN_INTEGRATION.md`, e.g. `GET /onchain/aid-escrow/packages/:id`,
   or run `get-aggregates` via `testnet-invoke.sh`) before touching mobile.
4. **Update mobile last**, since `EXPO_PUBLIC_*` vars are baked in at build
   time (not runtime-configurable) and shipping a new build to users takes
   the longest (EAS build + store review lag on iOS in particular). Update
   `app/mobile/.env`, rebuild, and roll out through your normal release
   channel.
5. **Update `REGISTRY.md`'s Notes column** for the new row with the date each
   consumer actually started using it — this is what makes "what was live
   when" answerable later, not just "when did we deploy the contract."

### 6.3 Rollback basics

Soroban contracts are immutable at a given contract ID — there is no "revert
the deployment." Two independent tools cover the two failure modes:

- **Contract is misbehaving and you need to stop traffic immediately:**
  call the admin-only `pause()` method (see the Method Reference table in
  `contracts/aid_escrow/README.md`) against the *current* contract ID via
  `soroban contract invoke` or a small addition to `testnet-invoke.sh`. This
  halts state-changing operations without touching any consumer config, and
  buys time to investigate. `unpause()` resumes it once you've confirmed the
  issue is understood — pausing is not itself a rollback.
- **You need consumers back on the previous contract entirely:** this is a
  config rollback, not a contract rollback. Reverse the steps in §6.2 against
  the previous entry in `REGISTRY.md` (mark the row you deployed
  `superseded`, and either flip the previous row's Status back to `active`
  with a note, or add a fresh row if state has diverged and you're not
  simply reverting): backend env var back to the old `SOROBAN_CONTRACT_ID`,
  restart, verify, then mobile env var + rebuild if mobile had already
  shipped with the new ID. If the mobile app already shipped with the new ID
  to end users, rolling the backend back alone will point old and new mobile
  builds at different contracts — treat that split as expected during any
  rollback and communicate it, don't assume rollback is atomic across
  consumers.
- **Forward-fix instead of rollback, when possible.** If the contract itself
  needs a genuine bug fix rather than a config revert, prefer the versioned
  `migrate()` path described in `VERSIONING.md` over redeploying to a new
  contract ID, since a new ID starts with empty storage and loses all
  existing packages/balances. Migration is the only path that preserves
  state; a fresh deploy plus registry/consumer rewiring is for cases where
  starting clean is acceptable (e.g. early testnet iteration).

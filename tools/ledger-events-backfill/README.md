# Ledger Events Backfill (Soroban)

A standalone Node.js CLI that backfills **Soroban contract events** for a given ledger range with safe resume, structured progress logs, and Prometheus-style metrics.

The tool is intentionally independent of the NestJS backend so it can run in cron jobs, CI, or as a one-off operator action without booting the full API.

## Features

- **Range-based** — Specify `--start` and `--end` (inclusive) Soroban ledger sequences.
- **Filterable** — Restrict to one or more contracts via `--contract CC...` (`--type` defaults to `contract`, the only filter type Soroban RPC supports).
- **Safe resume** — Checkpoint written atomically after every batch. Re-running with the same `--checkpoint` path picks up from `lastLedgerCompleted + 1`.
- **Progress logs** — Structured JSON-per-line to **stderr** (`--log-format json|pretty`).
- **Metrics** — Prometheus text format written to `--metrics-output`. Live status viewable via `--status` (reads checkpoint).
- **Idempotent** — Re-running for an already-processed range is a no-op (verified via checkpoint).
- **Pagination-aware** — Follows `cursor` from `getEvents` (Soroban RPC caps pages, so multi-page batches are common).
- **Backoff & retries** — Exponential backoff on transient RPC errors. Configurable via env vars.

## Install

```bash
cd tools/ledger-events-backfill
npm ci
```

## Usage

### Backfill events for a ledger range

```bash
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
SOROBAN_CONTRACT_ID=CCABC... \
node index.js --start 100000 --end 110000 --type contract
```

Each event is emitted as a JSON line (NDJSON) on **stdout**. To write to a file instead:

```bash
node index.js --start 100000 --end 110000 --output events.ndjson
```

### Resume from last checkpoint

The CLI writes a checkpoint JSON file after every batch. To resume, just re-run with the same `--checkpoint` path:

```bash
# First run processes ledgers 100000-100099, then dies
node index.js --start 100000 --end 110000 --checkpoint /tmp/btm.checkpoint.json

# Resume — CLI auto-detects resume and continues from 100100
node index.js --start 100000 --end 110000 --checkpoint /tmp/btm.checkpoint.json
```

Or let the CLI pick a default checkpoint file derived from contract + range:

```bash
node index.js --start 100000 --end 110000  # checkpoint stored in ./checkpoints/<contract>_<start>_<end>.json
```

### Check status

```bash
node index.js --status --checkpoint /tmp/btm.checkpoint.json
```

Sample output:

```
checkpoint: /tmp/btm.checkpoint.json
range:      100000 → 110000 (100001 ledgers)
contract:   CCABCDEF...
completed:  100487 ledger
events:     3120
started:    2026-06-27T10:00:01.412Z
updated:    2026-06-27T10:01:23.901Z
status:     in_progress
```

## CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--start` | _required_ unless `--status` | Start ledger sequence (inclusive) |
| `--end` | _required_ unless `--status` | End ledger sequence (inclusive) |
| `--contract` | `$SOROBAN_CONTRACT_ID` | Filter events by contract ID(s) (comma-separated) |
| `--contract` | _required filter_ | Contract ID(s) to filter, comma-separated |
| `--type` | `contract` | Event filter type (Soroban RPC only supports `contract`) |
| `--topic-filter` | _none_ | Optional topic filter (e.g. `"AAA.....,*"`) |
| `--batch-size` | `100` | Number of ledgers per batch (RPC request boundary) |
| `--checkpoint` | `./checkpoints/<contract>_<start>_<end>.json` | Path to checkpoint JSON |
| `--output` | _stdout_ | NDJSON file to write events (else stdout) |
| `--metrics-output` | `./metrics.prom` | Path to Prometheus text-format metrics file |
| `--log-format` | `pretty` | `pretty` or `json` (stderr) |
| `--max-retries` | `5` | Retries per RPC call |
| `--retry-delay-ms` | `500` | Initial retry delay (exponential backoff) |
| `--rpc-timeout-ms` | `30000` | RPC timeout per call |
| `--status` | _none_ | Print checkpoint status and exit (exits 2 if missing) |
| `--reset` | _none_ | Delete the checkpoint file (`--checkpoint` path) and exit |

## Environment Variables

| Var | Default | Purpose |
|-----|---------|---------|
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC URL |
| `SOROBAN_CONTRACT_ID` | _none_ | Default contract filter (overridden by `--contract`) |
| `BACKFILL_MAX_RETRIES` | `5` | Same as `--max-retries` |
| `BACKFILL_RETRY_DELAY_MS` | `500` | Same as `--retry-delay-ms` |
| `BACKFILL_RPC_TIMEOUT_MS` | `30000` | Same as `--rpc-timeout-ms` |

## Outputs

### stdout (NDJSON)

### `--topic-filter` caveat

The SDK's topic syntax allows commas inside a single filter (e.g. `AAA,BBB,*` is one filter that matches a tuple). To preserve that semantics, `--topic-filter` expects the entire JSON-array form quoted on the command line:

```bash
node index.js --start 100 --end 200 \
  --contract CC... \
  --topic-filter '["AAA,...","*"]'
```

A bare comma-separated list (`--topic-filter "X,Y"`) is split on commas and would be interpreted as two separate filters. If your filter has no internal commas you can use the bare form.

### `--reset`

Deleting a checkpoint is irreversible (the file is `unlink`'d). After `--reset`, the next run starts the backfill from `--start` again. Useful when:
- the checkpoint was corrupted
- you want to re-emit the entire NDJSON stream to a fresh output file
- you changed `--contract` / `--type` and need to start over

### Resuming after `--reset`

`--reset` only removes the checkpoint. The previously-emitted NDJSON file at `--output` is left untouched. To start cleanly, either delete the existing `--output` file or rotate it (e.g. `mv events.ndjson events.ndjson.bak`).

### `--status` exit codes

| Exit | Meaning |
|------|---------|
| `0` | Checkpoint printed successfully |
| `2` | Checkpoint file not found (treat as "no in-flight run") |

```json
{"ledger":100001,"txHash":"abc...","contractId":"CC...","eventType":"contract","topics":["AAA..."],"data":{"type":"symbol","value":"claim_created"},"id":"...","timestamp":"2026-06-27T10:00:01.412Z"}
```

### stderr (progress logs)

One line per batch (pretty or json):

```
[10:00:01] batch 100000→100099  events=24  retries=0  elapsed=1.42s
```

### metrics file (Prometheus)

```
# HELP ledger_backfill_events_total Total events fetched
# TYPE ledger_backfill_events_total counter
ledger_backfill_events_total 3120
# HELP ledger_backfill_batches_total Total RPC batches fetched
# TYPE ledger_backfill_batches_total counter
ledger_backfill_batches_total{status="success"} 5
...
```

## Tests

```bash
npm test
```

Uses Node's built-in test runner (`node --test`). Mocks the Soroban RPC client with an in-memory event generator and a fake RPC server.

## Resume Semantics (At-Least-Once)

The CLI is **at-least-once** for the in-flight batch. The order inside a single batch is:

1. RPC call returns N events.
2. Each event is appended to the NDJSON `--output` file and counted in metrics.
3. The checkpoint file is atomically updated to mark the batch as complete.

If the process crashes (or is killed) between steps 2 and 3, those N events will be **re-emitted on resume** because the checkpoint never advanced.

In practice this is almost always benign — but downstream systems that cannot tolerate duplicates should:

- Always use a unique idempotency key per event (e.g. `ledger + txHash + eventIndex`) when ingesting the NDJSON stream, OR
- Truncate the NDJSON file before resuming by deleting only the trailing partial batch (the batch boundary is recorded in the checkpoint), OR
- Run the CLI in a transactional pipeline (e.g. BigQuery streaming inserts) that supports `INSERT IGNORE` semantics.

Within a batch the order is also at-least-once on the *batch boundary* (not per-event) — events are written in order, but the checkpoint advances in batch units.

## File Layout

```
tools/ledger-events-backfill/
├── package.json
├── README.md
├── index.js              # CLI entry point (arg parsing + glue)
├── src/
│   ├── checkpoint.js    # Atomic checkpoint persistence
│   ├── events.js        # Soroban RPC getEvents + pagination + retry
│   ├── progress.js      # Structured progress logger
│   ├── metrics.js       # Prometheus-style metrics collector
│   └── split.js         # Range-to-batch splitter
└── test/
    ├── checkpoint.spec.js
    ├── events.spec.js
    ├── progress.spec.js
    └── metrics.spec.js
```

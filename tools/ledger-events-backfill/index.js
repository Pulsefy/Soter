#!/usr/bin/env node
'use strict';

/**
 * ledger-events-backfill CLI
 *
 * Range-based, checkpointed backfill of Soroban contract events with
 * progress logs and Prometheus-style metrics.
 *
 * See README.md for usage.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const { Checkpoint, CheckpointError } = require('./src/checkpoint');
const { EventsClient } = require('./src/events');
const { ProgressLogger } = require('./src/progress');
const { MetricsCollector } = require('./src/metrics');
const { splitRange } = require('./src/split');

const DEFAULTS = {
  // The following values can change at runtime, so they are exposed as
  // getters rather than plain fields. Tests override `process.env` after
  // module load and expect the new values to take effect.
  get rpcUrl() {
    return process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
  },
  get contractIds() {
    if (!process.env.SOROBAN_CONTRACT_ID) return [];
    return process.env.SOROBAN_CONTRACT_ID.split(',').map((s) => s.trim()).filter(Boolean);
  },
  batchSize: 100,
  // Max events per RPC page. Soroban RPC typically caps at ~100; we request
  // 1000 for headroom on networks with higher caps. Pagination via cursor
  // handles arbitrary result-set sizes regardless of this value.
  pageLimit: 1000,
  get maxRetries() {
    return parseInt(process.env.BACKFILL_MAX_RETRIES || '5', 10);
  },
  get retryDelayMs() {
    return parseInt(process.env.BACKFILL_RETRY_DELAY_MS || '500', 10);
  },
  get rpcTimeoutMs() {
    return parseInt(process.env.BACKFILL_RPC_TIMEOUT_MS || '30000', 10);
  },
  logFormat: 'pretty',
};

// ── Argument parsing ──────────────────────────────────────────────────────

/**
 * Cheap zero-dep argument parser tailored to this CLI.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const out = { _: [], help: false, status: false, reset: false };
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok === '--help' || tok === '-h') out.help = true;
    else if (tok === '--status') out.status = true;
    else if (tok === '--reset') out.reset = true;
    else if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    } else {
      out._.push(tok);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node index.js [options]

Backfill Soroban contract events for a ledger range with safe resume.

Required (unless --status):
  --start <n>              Start ledger sequence (inclusive)
  --end <n>                End ledger sequence (inclusive)

Filter:
  --contract <id[,id,...]> Contract ID(s) to filter (or $SOROBAN_CONTRACT_ID)
  --type <type>            Filter type (default: contract)

Resume & output:
  --checkpoint <path>      Checkpoint JSON path (default: ./checkpoints/<contract>_<start>_<end>.json)
  --output <path>          NDJSON output file (default: stdout)
  --metrics-output <path>  Prometheus metrics file (default: ./metrics.prom)

Orchestration:
  --batch-size <n>         Ledgers per RPC batch (default: 100)
  --max-retries <n>        Retries per RPC call (default: 5)
  --retry-delay-ms <n>     Initial backoff delay (default: 500)
  --rpc-timeout-ms <n>     RPC timeout per call (default: 30000)

Logging:
  --log-format <pretty|json>
  --silent                 Suppress progress logs to stderr

Other:
  --status                 Print checkpoint status and exit
  --reset                  Wipe checkpoint and start fresh
`);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function defaultCheckpointPath(contractIds, startLedger, endLedger) {
  // Allow callers to pass strings/arrays for forward compatibility.
  const ids = Array.isArray(contractIds) ? contractIds : (contractIds ? [contractIds] : []);
  // Pick a stable, filesystem-friendly slug from the first contract id when
  // present. We deliberately do NOT include the full id — Soroban contract
  // ids are 56+ chars and would push us past sane path lengths, and the
  // inclusion of commas (when users supply multiple contracts) would create
  // ambiguous shell-quoting. Filenames are advisory — checkpoint contents
  // record the full contract list with no information loss.
  const first = ids[0] || 'default';
  let safeSlug;
  if (typeof first === 'string' && first.length > 0) {
    safeSlug = first
      .replace(/[^a-zA-Z0-9_.-]/g, '_')
      .slice(0, 16) || 'default';
  } else {
    safeSlug = 'default';
  }
  if (startLedger === undefined || endLedger === undefined) {
    return path.resolve('checkpoints', `${safeSlug}.json`);
  }
  return path.resolve(
    'checkpoints',
    `${safeSlug}_${startLedger}_${endLedger}.json`,
  );
}

function toInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n)) throw new Error(`expected integer, got ${value}`);
  return n;
}

function parseContractIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Append a single event to either a file stream or stdout NDJSON.
 */
class EventSink {
  constructor(outputPath) {
    this.outputPath = outputPath || null;
    /** @type {fs.WriteStream|null} */
    this.stream = null;
    if (outputPath) {
      this.stream = fs.createWriteStream(outputPath, { flags: 'a', encoding: 'utf8' });
    }
  }
  write(event) {
    let line;
    try {
      line = JSON.stringify({
        ledger: event.ledger,
        txHash: event.txHash || (event.transactionHash) || null,
        contractId: event.contractId,
        eventType: event.type || event.eventType,
        topics: event.topic || event.topics || [],
        data: event.data,
        id: event.id || null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      // If the event itself is not serialisable, fall back to raw.
      line = JSON.stringify({ ledger: event.ledger, raw: String(event) });
    }
    (this.stream || process.stdout).write(line + '\n');
  }
  async close() {
    if (this.stream) {
      await new Promise((r) => this.stream.end(r));
    }
  }
}

// ── Status command ────────────────────────────────────────────────────────

async function runStatus(args, logger) {
  const checkpointPath = args.checkpoint
    ? path.resolve(args.checkpoint)
    : defaultCheckpointPath(
        parseContractIds(args.contract || DEFAULTS.contractIds.join(',') || null),
        args.start ? parseInt(args.start, 10) : undefined,
        args.end ? parseInt(args.end, 10) : undefined,
      );
  let state;
  try {
    const raw = await fsp.readFile(checkpointPath, 'utf8');
    state = JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`No checkpoint found at ${checkpointPath}`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
  const placeholder = (v) => (v === undefined ? '(unset)' : v);
  console.log(JSON.stringify({
    checkpoint: checkpointPath,
    range: { start: state.startLedger, end: state.endLedger, total: state.endLedger - state.startLedger + 1 },
    contracts: state.contractIds,
    filterType: state.filterType,
    lastLedgerCompleted: placeholder(state.lastLedgerCompleted),
    resumeFrom: state.lastLedgerCompleted !== undefined ? state.lastLedgerCompleted + 1 : state.startLedger,
    events: state.totalEvents,
    batches: state.totalBatches,
    retries: state.totalRetries,
    status: state.status,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    lastError: state.lastError || null,
  }, null, 2));
  logger.info('status_displayed', { path: checkpointPath });
}

// ── Reset command ─────────────────────────────────────────────────────────

async function runReset(args, logger) {
  const checkpointPath = args.checkpoint
    ? path.resolve(args.checkpoint)
    : defaultCheckpointPath(
        parseContractIds(args.contract || DEFAULTS.contractIds.join(',') || null),
        args.start ? parseInt(args.start, 10) : undefined,
        args.end ? parseInt(args.end, 10) : undefined,
      );
  try {
    await fsp.unlink(checkpointPath);
    logger.info('checkpoint_reset', { path: checkpointPath });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    logger.warn('checkpoint_not_found', { path: checkpointPath });
  }
}

// ── Backfill orchestrator ─────────────────────────────────────────────────

async function runBackfill(args, logger, metrics) {
  const startLedger = toInt(args.start, undefined);
  const endLedger = toInt(args.end, undefined);
  if (startLedger === undefined || endLedger === undefined) {
    throw new Error('--start and --end are required unless --status is set');
  }
  if (endLedger < startLedger) {
    throw new Error('--end must be >= --start');
  }

  const contractIds = parseContractIds(args.contract || DEFAULTS.contractIds.join(','));
  if (contractIds.length === 0) {
    throw new Error(
      'No contract filter supplied. Use --contract CC... or set $SOROBAN_CONTRACT_ID.',
    );
  }

  const filterType = args.type || 'contract';
  // Optional topic filter — comma-separated, e.g. "AAA=,*" passes through to the SDK.
  const topicFilters = parseContractIds(args['topic-filter']);
  const batchSize = toInt(args['batch-size'], DEFAULTS.batchSize);
  const maxRetries = toInt(args['max-retries'], DEFAULTS.maxRetries);
  const retryDelayMs = toInt(args['retry-delay-ms'], DEFAULTS.retryDelayMs);
  const rpcTimeoutMs = toInt(args['rpc-timeout-ms'], DEFAULTS.rpcTimeoutMs);
  const logFormat = args['log-format'] || DEFAULTS.logFormat;
  const silent = !!args.silent;
  const rpcUrl = DEFAULTS.rpcUrl;

  const checkpointPath = args.checkpoint
    ? path.resolve(args.checkpoint)
    : defaultCheckpointPath(contractIds, startLedger, endLedger);
  const metricsPath = path.resolve(args['metrics-output'] || 'metrics.prom');

  logger.info('backfill_start', {
    rpc: rpcUrl,
    contracts: contractIds.join(','),
    range: `${startLedger}-${endLedger}`,
    checkpoint: checkpointPath,
  });

  const checkpoint = new Checkpoint(checkpointPath);
  await checkpoint.begin({
    rpcUrl,
    contractIds,
    filterType,
    startLedger,
    endLedger,
    batchSize,
  });

  const filter = { type: filterType, contractIds };
  if (topicFilters.length > 0) filter.topics = topicFilters;
  const sink = new EventSink(args.output || null);
  const events = new EventsClient(rpcUrl);

  const resumeAt = checkpoint.resumeLedger() + 1;
  const batches = splitRange(resumeAt, endLedger, batchSize);

  logger.info('resume_plan', {
    lastLedgerCompleted: checkpoint.state.lastLedgerCompleted,
    nextBatchStart: resumeAt,
    batches: batches.length,
  });

  let totalRetries = 0;
  let totalEvents = 0;
  let totalBatches = 0;

  try {
    for (const [idx, batch] of batches.entries()) {
      const timer = logger.startBatch();
      try {
        const opts = {
          startLedger: batch.startLedger,
          endLedger: batch.endLedger,
          limit: DEFAULTS.pageLimit,
          maxRetries,
          retryDelayMs,
          rpcTimeoutMs,
          onEvent: (ev) => {
            totalEvents += 1;
            sink.write(ev);
            metrics.incCounter('ledger_backfill_events_total', { type: filterType });
          },
          onRetry: ({ attempt, delay, err }) => {
            totalRetries += 1;
            logger.warn('rpc_retry', {
              batch: `${batch.startLedger}-${batch.endLedger}`,
              attempt,
              delayMs: delay,
              err: err.slice(0, 120),
            });
            metrics.incCounter('ledger_backfill_rpc_retries_total', { type: filterType });
          },
        };
        const result = await metrics.time(
          'ledger_backfill_batch_duration_seconds',
          { type: filterType },
          () => events.fetchAll(filter, opts),
        );
        totalBatches += 1;
        metrics.incCounter('ledger_backfill_batches_total', { status: 'success', type: filterType });
        await checkpoint.complete(batch.endLedger, {
          events: result.events,
          retries: result.retries,
        });
        logger.info('batch_complete', {
          batch: `${batch.startLedger}-${batch.endLedger}`,
          events: result.events,
          retries: result.retries,
          elapsedMs: timer.stop(),
          progress: `${idx + 1}/${batches.length}`,
        });
      } catch (err) {
        metrics.incCounter('ledger_backfill_batches_total', { status: 'failed', type: filterType });
        logger.error('batch_failed', {
          batch: `${batch.startLedger}-${batch.endLedger}`,
          err: String(err && err.message ? err.message : err),
        });
        await checkpoint.markFailed(String(err && err.message ? err.message : err));
        throw err;
      }
    }

    metrics.setGauge('ledger_backfill_last_completed_ledger', checkpoint.state.lastLedgerCompleted || 0);
    metrics.setGauge('ledger_backfill_total_events_emitted', totalEvents);

    logger.info('backfill_complete', {
      totalEvents,
      totalBatches,
      totalRetries,
      checkpoint: checkpointPath,
      metrics: metricsPath,
      status: checkpoint.state.status,
    });
  } finally {
    // Always flush the NDJSON sink + metrics file, even on the failure path,
    // so partial progress is durable and the operator can resume without losing
    // events that were already fetched.
    await sink.close();
    try {
      await fsp.mkdir(path.dirname(metricsPath), { recursive: true });
      await fsp.writeFile(metricsPath, metrics.render(), 'utf8');
    } catch (err) {
      logger.warn('metrics_write_failed', { err: String(err.message) });
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const metrics = new MetricsCollector();
  const logger = new ProgressLogger({
    format: args['log-format'] || DEFAULTS.logFormat,
    silent: !!args.silent,
  });

  try {
    if (args.reset) {
      await runReset(args, logger);
      return;
    }
    if (args.status) {
      await runStatus(args, logger);
      return;
    }
    await runBackfill(args, logger, metrics);
  } catch (err) {
    if (err instanceof CheckpointError) {
      console.error(`Checkpoint error: ${err.message}`);
      process.exitCode = 3;
      return;
    }
    console.error(`Fatal: ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, runBackfill, runStatus, runReset };

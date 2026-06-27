'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const { runBackfill, runStatus, parseArgs } = require('../index');
const { ProgressLogger } = require('../src/progress');
const { MetricsCollector } = require('../src/metrics');
const { EventsClient, MockSorobanServer } = require('../src/events');

async function tempDir() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'btm-e2e-'));
  return { dir, cleanup: () => fsp.rm(dir, { recursive: true, force: true }) };
}

function makeEvents(startLedger, endLedger, perLedger = 2) {
  const out = [];
  for (let l = startLedger; l <= endLedger; l += 1) {
    for (let i = 0; i < perLedger; i += 1) {
      out.push({
        ledger: l,
        contractId: 'C-CONT',
        type: 'contract',
        topic: ['AAA=', `idx=${i}`],
        data: { v: i },
        txHash: `t-${l}-${i}`,
      });
    }
  }
  return out;
}

/**
 * Replace EventsClient.fetchAll with one that wires a mock Soroban server. Returns
 * a restore function. Use in a try/finally to clean up.
 *
 * Kept tiny because the orchestrator constructs EventsClient inside runBackfill.
 */
function withMockServer(mock) {
  const original = EventsClient.prototype.fetchAll;
  EventsClient.prototype.fetchAll = async function (filter, opts) {
    this.server = mock;
    return original.call(this, filter, opts);
  };
  return () => { EventsClient.prototype.fetchAll = original; };
}

test('end-to-end: runs a fresh backfill to completion', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const events = makeEvents(100, 119);  // 20 ledgers * 2 = 40 events
    const restore = withMockServer(new MockSorobanServer({ events }));

    const outNdjson = path.join(dir, 'out.ndjson');
    const metricsFile = path.join(dir, 'metrics.prom');
    const cp = path.join(dir, 'cp.json');

    const args = parseArgs([
      '--start', '100',
      '--end', '119',
      '--contract', 'C-CONT',
      '--batch-size', '50',
      '--checkpoint', cp,
      '--output', outNdjson,
      '--metrics-output', metricsFile,
      '--silent',
    ]);

    try {
      const logger = new ProgressLogger({ silent: true });
      const m = new MetricsCollector();
      await runBackfill(args, logger, m);
    } finally {
      restore();
    }

    const state = JSON.parse(await fsp.readFile(cp, 'utf8'));
    assert.equal(state.status, 'completed');
    assert.equal(state.lastLedgerCompleted, 119);
    assert.equal(state.totalEvents, 40);

    // Output NDJSON should have 40 lines, each starting at ledger 100.
    const out = (await fsp.readFile(outNdjson, 'utf8')).trim().split('\n');
    assert.equal(out.length, 40);
    const first = JSON.parse(out[0]);
    assert.equal(first.ledger, 100);
    assert.equal(first.contractId, 'C-CONT');

    // Metrics file should contain counters.
    const met = await fsp.readFile(metricsFile, 'utf8');
    assert.match(met, /^# TYPE ledger_backfill_events_total counter/m);
    assert.match(met, /^ledger_backfill_events_total\{type="contract"\} 40$/m);
    assert.match(met, /ledger_backfill_batches_total\{status="success",type="contract"\} 1/m);
  } finally { await cleanup(); }
});

test('end-to-end: resumes from a pre-existing checkpoint', async () => {
  const { dir, cleanup } = await tempDir();
  const origRpcEnv = process.env.SOROBAN_RPC_URL;
  // Force runBackfill to use the same rpcUrl we wrote into the pre-seeded
  // checkpoint, otherwise Checkpoint.begin() rejects the run as "different run".
  process.env.SOROBAN_RPC_URL = 'https://fake';
  try {
    const procId = 'C-CONT';
    const cp = path.join(dir, 'cp.json');

    // Pre-populate checkpoint as if a previous run processed ledgers 1000-1049.
    // (In a real outage: process died mid-way through a 1000-1099 range.)
    await fsp.writeFile(
      cp,
      JSON.stringify({
        lastLedgerCompleted: 1049,
        totalEvents: 100,
        totalBatches: 1,
        totalRetries: 0,
        startedAt: new Date(Date.now() - 60000).toISOString(),
        updatedAt: new Date(Date.now() - 30000).toISOString(),
        rpcUrl: 'https://fake',
        contractIds: [procId],
        filterType: 'contract',
        startLedger: 1000,
        endLedger: 1099,
        batchSize: 50,
        status: 'in_progress',
      }, null, 2),
    );

    // The mock only serves events for ledgers 1050-1099: the second half of
    // the original range. If resume works, only these events should appear in
    // the output NDJSON.
    const mockEvents = makeEvents(1050, 1099);
    const restore = withMockServer(new MockSorobanServer({ events: mockEvents }));

    const outNdjson = path.join(dir, 'out.ndjson');
    const args = parseArgs([
      '--start', '1000',
      '--end', '1099',
      '--contract', procId,
      '--batch-size', '50',
      '--checkpoint', cp,
      '--output', outNdjson,
      '--silent',
    ]);

    try {
      const logger = new ProgressLogger({ silent: true });
      const m = new MetricsCollector();
      await runBackfill(args, logger, m);
    } finally {
      restore();
    }

    const state = JSON.parse(await fsp.readFile(cp, 'utf8'));
    assert.equal(state.status, 'completed');
    assert.equal(state.lastLedgerCompleted, 1099);
    // Tally: 100 events from previous run + 100 fetched this run = 200.
    // Important: we did NOT double-count ledgers 1000-1049.
    assert.equal(state.totalEvents, 200);
    // 1 batch from previous + 1 batch from this run = 2.
    assert.equal(state.totalBatches, 2);

    // Output should ONLY contain the freshly fetched events (ledgers 1050-1099).
    const out = (await fsp.readFile(outNdjson, 'utf8')).trim().split('\n');
    assert.equal(out.length, 100);
    const first = JSON.parse(out[0]);
    assert.equal(first.ledger, 1050, 'first event should be ledger 1050 (resumed)');
    const last = JSON.parse(out[out.length - 1]);
    assert.equal(last.ledger, 1099, 'last event should be ledger 1099');
  } finally {
    process.env.SOROBAN_RPC_URL = origRpcEnv;
    await cleanup();
  }
});

test('end-to-end: refuses to resume under incompatible metadata', async () => {
  const { dir, cleanup } = await tempDir();
  const origRpcEnv = process.env.SOROBAN_RPC_URL;
  process.env.SOROBAN_RPC_URL = 'https://fake';
  try {
    // Pre-populate checkpoint for endLedger=1049
    const cp = path.join(dir, 'cp.json');
    await fsp.writeFile(
      cp,
      JSON.stringify({
        lastLedgerCompleted: 1049,
        totalEvents: 0,
        totalBatches: 0,
        totalRetries: 0,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rpcUrl: 'https://fake',
        contractIds: ['C-CONT'],
        filterType: 'contract',
        startLedger: 1000,
        endLedger: 1049,
        batchSize: 50,
        status: 'in_progress',
      }, null, 2),
    );

    // Try to resume with mismatched endLedger
    const args = parseArgs([
      '--start', '1000', '--end', '1099',
      '--contract', 'C-CONT',
      '--checkpoint', cp,
      '--silent',
    ]);

    const restore = withMockServer(new MockSorobanServer({ events: [] }));
    try {
      const logger = new ProgressLogger({ silent: true });
      const m = new MetricsCollector();
      await assert.rejects(
        () => runBackfill(args, logger, m),
        /different run/,
      );
    } finally {
      restore();
    }
  } finally {
    process.env.SOROBAN_RPC_URL = origRpcEnv;
    await cleanup();
  }
});

test('end-to-end: --status prints checkpoint JSON when present', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const cp = path.join(dir, 'cp.json');
    await fsp.writeFile(
      cp,
      JSON.stringify({
        lastLedgerCompleted: 1049,
        totalEvents: 12,
        totalBatches: 2,
        totalRetries: 0,
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
        rpcUrl: 'https://example',
        contractIds: ['CC'],
        filterType: 'contract',
        startLedger: 1000,
        endLedger: 1100,
        batchSize: 50,
        status: 'in_progress',
      }, null, 2),
    );

    const stdoutChunks = [];
    const origLog = console.log;
    console.log = (...args) => stdoutChunks.push(args.join(' '));
    try {
      const logger = new ProgressLogger({ silent: true });
      await runStatus({ checkpoint: cp }, logger);
    } finally {
      console.log = origLog;
    }
    const out = stdoutChunks.join('\n');
    assert.match(out, /"lastLedgerCompleted": 1049/);
    assert.match(out, /"resumeFrom": 1050/);
  } finally { await cleanup(); }
});

test('end-to-end: --status exits with code 2 when checkpoint is missing', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const stderrChunks = [];
    const origErr = console.error;
    const origExitCode = process.exitCode;
    // runStatus sets process.exitCode = 2 then returns; capture it BEFORE the
    // restoration of origExitCode in finally.
    let observedExitCode;
    console.error = (...args) => stderrChunks.push(args.join(' '));
    try {
      const logger = new ProgressLogger({ silent: true });
      await runStatus({ checkpoint: path.join(dir, 'missing.json') }, logger);
      observedExitCode = process.exitCode;
    } finally {
      console.error = origErr;
      process.exitCode = origExitCode;
    }
    assert.equal(observedExitCode, 2);
    assert.match(stderrChunks.join(' '), /No checkpoint found/);
  } finally { await cleanup(); }
});

test('parseArgs: extracts --key value pairs and boolean flags', () => {
  const out = parseArgs([
    '--start', '100',
    '--status',
    '--silent',
    '--log-format', 'json',
  ]);
  assert.equal(out.start, '100');
  assert.equal(out.status, true);
  assert.equal(out.silent, true);
  assert.equal(out['log-format'], 'json');
});

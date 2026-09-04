'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const { Checkpoint, CheckpointError } = require('../src/checkpoint');

async function tempDir() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'btm-cp-'));
  return { dir, cleanup: () => fsp.rm(dir, { recursive: true, force: true }) };
}

const META = {
  rpcUrl: 'https://example.test',
  contractIds: ['CAAAA', 'CBBBB'],
  filterType: 'contract',
  startLedger: 1000,
  endLedger: 1100,
  batchSize: 50,
};

test('Checkpoint: begins empty state when no file exists', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const cp = new Checkpoint(path.join(dir, 'cp.json'));
    const s = await cp.begin(META);
    assert.equal(typeof s.startedAt, 'string');
    assert.equal(s.lastLedgerCompleted, undefined);
    assert.equal(s.totalEvents, 0);
    assert.equal(s.totalBatches, 0);
    assert.equal(s.startLedger, 1000);
    assert.equal(s.endLedger, 1100);
    assert.equal(s.batchSize, 50);
    assert.equal(s.status, 'in_progress');
    // file should exist on disk
    const exists = await fsp.stat(path.join(dir, 'cp.json')).then(() => true).catch(() => false);
    assert.equal(exists, true);
  } finally { await cleanup(); }
});

test('Checkpoint: complete() advances lastLedgerCompleted and persists counters', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const p = path.join(dir, 'cp.json');
    const cp = new Checkpoint(p);
    await cp.begin(META);
    await cp.complete(1049, { events: 12, retries: 0 });
    let s = JSON.parse(await fsp.readFile(p, 'utf8'));
    assert.equal(s.lastLedgerCompleted, 1049);
    assert.equal(s.totalBatches, 1);
    assert.equal(s.totalEvents, 12);

    await cp.complete(1099, { events: 7, retries: 2 });
    s = JSON.parse(await fsp.readFile(p, 'utf8'));
    assert.equal(s.lastLedgerCompleted, 1099);
    assert.equal(s.totalBatches, 2);
    assert.equal(s.totalEvents, 19);
    assert.equal(s.totalRetries, 2);
  } finally { await cleanup(); }
});

test('Checkpoint: status flips to completed when endLedger reached', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const cp = new Checkpoint(path.join(dir, 'cp.json'));
    await cp.begin(META);
    await cp.complete(1100);
    assert.equal(cp.state.status, 'completed');
  } finally { await cleanup(); }
});

test('Checkpoint: complete() is idempotent on re-call with same ledger', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const cp = new Checkpoint(path.join(dir, 'cp.json'));
    await cp.begin(META);
    await cp.complete(1049, { events: 10 });
    await cp.complete(1049, { events: 10 });   // same ledger, idempotent
    assert.equal(cp.state.lastLedgerCompleted, 1049);
    assert.equal(cp.state.totalBatches, 1);    // not 2!
    assert.equal(cp.state.totalEvents, 20);    // +10 twice
  } finally { await cleanup(); }
});

test('Checkpoint: resumeLedger() returns startLedger-1 when fresh', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const cp = new Checkpoint(path.join(dir, 'cp.json'));
    await cp.begin(META);
    assert.equal(cp.resumeLedger(), 999);
  } finally { await cleanup(); }
});

test('Checkpoint: resumeLedger() returns lastLedgerCompleted after progress', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const cp = new Checkpoint(path.join(dir, 'cp.json'));
    await cp.begin(META);
    await cp.complete(1049);
    assert.equal(cp.resumeLedger(), 1049);
  } finally { await cleanup(); }
});

test('Checkpoint: reloading existing checkpoint preserves state', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const p = path.join(dir, 'cp.json');
    const cp1 = new Checkpoint(p);
    await cp1.begin(META);
    await cp1.complete(1049, { events: 5, retries: 1 });

    const cp2 = new Checkpoint(p);
    const s = await cp2.begin(META);
    assert.equal(s.lastLedgerCompleted, 1049);
    assert.equal(s.totalEvents, 5);
    assert.equal(s.totalRetries, 1);
    assert.equal(s.totalBatches, 1);
  } finally { await cleanup(); }
});

test('Checkpoint: refuses to resume under incompatible metadata', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const p = path.join(dir, 'cp.json');
    const cp1 = new Checkpoint(p);
    await cp1.begin(META);
    await cp1.complete(1049);

    const cp2 = new Checkpoint(p);
    await assert.rejects(
      () => cp2.begin({ ...META, startLedger: 5000 }),
      (err) => err instanceof CheckpointError && /different run/.test(err.message),
    );

    const cp3 = new Checkpoint(p);
    await assert.rejects(
      () => cp3.begin({ ...META, contractIds: ['CDIFFERENT'] }),
      (err) => err instanceof CheckpointError && /filtered by different contracts/.test(err.message),
    );
  } finally { await cleanup(); }
});

test('Checkpoint: markFailed() retains lastLedgerCompleted for inspection', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const cp = new Checkpoint(path.join(dir, 'cp.json'));
    await cp.begin(META);
    await cp.complete(1049);
    await cp.markFailed('lost connection during 1100-1150');
    assert.equal(cp.state.status, 'failed');
    assert.equal(cp.state.lastLedgerCompleted, 1049);
    assert.match(cp.state.lastError, /lost connection/);
  } finally { await cleanup(); }
});

test('Checkpoint: atomic write leaves no .tmp file behind', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const p = path.join(dir, 'cp.json');
    const cp = new Checkpoint(p);
    await cp.begin(META);
    await cp.complete(1049);
    const files = await fsp.readdir(dir);
    assert.equal(files.filter((f) => f.endsWith('.tmp')).length, 0);
    assert.ok(files.includes('cp.json'));
  } finally { await cleanup(); }
});

test('Checkpoint: rejects bad path', () => {
  assert.throws(() => new Checkpoint(''), /non-empty string/);
});

test('Checkpoint: rejects complete() before begin()', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const cp = new Checkpoint(path.join(dir, 'cp.json'));
    await assert.rejects(() => cp.complete(10), (err) => err instanceof CheckpointError);
  } finally { await cleanup(); }
});

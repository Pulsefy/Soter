'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('stream');
const { ProgressLogger } = require('../src/progress');

function captureStream() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, chunks };
}

test('ProgressLogger: pretty format emits [INF]/[WRN]/[ERR] prefixes', () => {
  const { stream, chunks } = captureStream();
  const log = new ProgressLogger({ format: 'pretty', stream });
  log.info('hello', { count: 3 });
  log.warn('almost out of retry budget');
  log.error('boom');
  assert.equal(chunks.length, 3);
  // Format: "<HH:MM:SS> [INF] msg  key=value"
  assert.match(chunks[0], /\[INF\] hello  count=3/);
  assert.match(chunks[1], /\[WRN\] almost out/);
  assert.match(chunks[2], /\[ERR\] boom/);
});

test('ProgressLogger: json format emits JSON lines including runId', () => {
  const { stream, chunks } = captureStream();
  const log = new ProgressLogger({ format: 'json', stream, runId: 'test-run' });
  log.info('started', { ledger: 100 });
  assert.equal(chunks.length, 1);
  const parsed = JSON.parse(chunks[0]);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.runId, 'test-run');
  assert.equal(parsed.msg, 'started');
  assert.equal(parsed.ledger, 100);
  assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
});

test('ProgressLogger: silent mode discards all writes', () => {
  const { stream, chunks } = captureStream();
  const log = new ProgressLogger({ format: 'pretty', stream, silent: true });
  log.info('should be dropped');
  log.error('also dropped');
  assert.equal(chunks.length, 0);
});

test('ProgressLogger: startBatch().stop() returns elapsed ms', async () => {
  const log = new ProgressLogger({ silent: true });
  const t = log.startBatch();
  await new Promise((r) => setTimeout(r, 25));
  const ms = t.stop();
  assert.ok(ms >= 20, `expected >=20ms, got ${ms}`);
  assert.ok(ms < 500, `expected <500ms, got ${ms}`);
});

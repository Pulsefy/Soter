'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { splitRange } = require('../src/split');

test('splitRange: exact multiple of batchSize', () => {
  const out = splitRange(100, 199, 100);
  assert.deepEqual(out, [
    { startLedger: 100, endLedger: 199 },
  ]);
});

test('splitRange: produces multiple batches', () => {
  const out = splitRange(100, 250, 50);
  assert.deepEqual(out, [
    { startLedger: 100, endLedger: 149 },
    { startLedger: 150, endLedger: 199 },
    { startLedger: 200, endLedger: 249 },
    { startLedger: 250, endLedger: 250 },
  ]);
});

test('splitRange: single ledger range', () => {
  assert.deepEqual(splitRange(42, 42, 10), [{ startLedger: 42, endLedger: 42 }]);
});

test('splitRange: rejects invalid inputs', () => {
  assert.throws(() => splitRange(-1, 100, 10), /non-negative/);
  assert.throws(() => splitRange(200, 100, 10), />=/);
  assert.throws(() => splitRange(100, 200, 0), />= 1/);
  assert.throws(() => splitRange(1.5, 100, 10), /integer/);
});

test('splitRange: total ledger count is preserved', () => {
  const out = splitRange(1000, 1999, 73);
  const cover = out.reduce((n, b) => n + (b.endLedger - b.startLedger + 1), 0);
  assert.equal(cover, 1000);
});

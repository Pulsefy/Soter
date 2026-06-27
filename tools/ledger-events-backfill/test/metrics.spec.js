'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MetricsCollector } = require('../src/metrics');

test('MetricsCollector: counter increments and renders', () => {
  const m = new MetricsCollector();
  m.incCounter('c_total');
  m.incCounter('c_total', { kind: 'a' });
  m.incCounter('c_total', { kind: 'a' }, 4);
  const out = m.render();
  assert.match(out, /^# HELP c_total /m);
  assert.match(out, /^# TYPE c_total counter/m);
  assert.match(out, /^c_total 1$/m);
  assert.match(out, /^c_total{kind="a"} 5$/m);
});

test('MetricsCollector: gauge sets values', () => {
  const m = new MetricsCollector();
  m.setGauge('g', 42);
  m.setGauge('g', 7, { region: 'us' });
  const out = m.render();
  assert.match(out, /^g 42$/m);
  assert.match(out, /^g{region="us"} 7$/m);
});

test('MetricsCollector: histogram observes values and reports buckets', () => {
  const m = new MetricsCollector();
  m.observe('h_seconds', 0.5);
  m.observe('h_seconds', 1.5);
  m.observe('h_seconds', 5.0);
  const out = m.render();
  assert.match(out, /^# TYPE h_seconds histogram/m);
  // 3 observations total.
  assert.match(out, /^h_seconds_count 3$/m);
  // sum = 0.5 + 1.5 + 5.0 = 7.
  assert.match(out, /^h_seconds_sum 7$/m);
  // Prometheus bucket semantics: `le="X"` counts observations with value <= X
  // (inclusive). So le=1 catches 0.5 (not 1.5 or 5.0); le=2.5 catches 0.5 + 1.5;
  // le=5 catches all three (5.0 <= 5); le=+Inf catches all three too.
  assert.match(out, /^h_seconds_bucket\{le="0\.5"\} 1$/m);
  assert.match(out, /^h_seconds_bucket\{le="1"\} 1$/m);
  assert.match(out, /^h_seconds_bucket\{le="2\.5"\} 2$/m);
  assert.match(out, /^h_seconds_bucket\{le="5"\} 3$/m);
  assert.match(out, /^h_seconds_bucket\{le="\+Inf"\} 3$/m);
});

test('MetricsCollector: time() records elapsed seconds', async () => {
  const m = new MetricsCollector();
  await m.time('op_seconds', { kind: 'x' }, async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  const out = m.render();
  assert.match(out, /^# TYPE op_seconds histogram/m);
  // Pull the count line.
  const lines = out.split('\n');
  const countLine = lines.find((l) => l.startsWith('op_seconds_count'));
  assert.ok(countLine);
  assert.match(countLine, / 1$/);
});

test('MetricsCollector: reset() wipes all metrics', () => {
  const m = new MetricsCollector();
  m.incCounter('x_total');
  m.setGauge('y', 1);
  m.observe('z', 0.5);
  assert.notEqual(m.render(), '');
  m.reset();
  assert.equal(m.render(), '');
});

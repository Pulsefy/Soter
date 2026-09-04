'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { EventsClient, MockSorobanServer } = require('../src/events');

function makeEvents(startLedger, endLedger, perLedger = 3) {
  const out = [];
  for (let l = startLedger; l <= endLedger; l += 1) {
    for (let i = 0; i < perLedger; i += 1) {
      out.push({
        ledger: l,
        contractId: 'CABC',
        type: 'contract',
        topic: ['AAA=', `idx=${i}`],
        data: { type: 'symbol', value: 'claim_created' },
        txHash: `tx-${l}-${i}`,
      });
    }
  }
  return out;
}

test('EventsClient: collects all events in a single batch', async () => {
  const events = makeEvents(100, 105, 3);  // explicit perLedger
  const fake = new MockSorobanServer({ events });
  const client = new EventsClient('https://fake', { server: fake });

  const collected = [];
  const result = await client.fetchAll(
    { type: 'contract', contractIds: ['CABC'] },
    {
      startLedger: 100,
      endLedger: 105,
      limit: 100, // > total, so single page
      onEvent: (e) => collected.push(e),
    },
  );
  assert.equal(collected.length, 18);  // 6 ledgers * 3 events
  assert.equal(result.events, 18);
  assert.equal(result.batches, 1);
});

test('EventsClient: paginates via cursor and aggregates counts', async () => {
  // 30 events, page size 10 -> expect 3 pages
  const events = makeEvents(200, 209, 1);  // 10 ledgers × 1 = 10 events
  // Multiply to get 30:
  const expanded = [];
  for (let i = 0; i < 3; i += 1) expanded.push(...events);

  const fake = new MockSorobanServer({ events: expanded });
  const client = new EventsClient('https://fake', { server: fake });

  const collected = [];
  const result = await client.fetchAll(
    { type: 'contract', contractIds: ['CABC'] },
    {
      startLedger: 200,
      endLedger: 209,
      limit: 10,
      onEvent: (e) => collected.push(e),
    },
  );
  assert.equal(collected.length, 30);
  assert.equal(result.events, 30);
  assert.equal(result.batches, 3);  // 30/10
  assert.ok(fake.calls >= 3);
});

test('EventsClient: retries on transient error and succeeds', async () => {
  // 1 event at ledger 300 with failOnce:1 -> second call succeeds.
  const events = makeEvents(300, 300, 1);
  const fake = new MockSorobanServer({
    events,
    behaviour: { failOnce: 1, transient: true },
  });
  const client = new EventsClient('https://fake', { server: fake });

  // Make retries fast.
  const result = await client.fetchPage(
    { type: 'contract', contractIds: ['CABC'] },
    {
      startLedger: 300,
      endLedger: 300,
      limit: 10,
      maxRetries: 3,
      retryDelayMs: 1,        // fast for tests
      onRetry: () => {},
    },
  );
  assert.equal(result.events.length, 1);
  assert.equal(result.stats.retries, 1);
  assert.equal(result.stats.attempts, 2);
  assert.equal(fake.calls, 2);
});

test('EventsClient: surfaces error after exhausting retries', async () => {
  const events = makeEvents(400, 400);
  const fake = new MockSorobanServer({
    events,
    behaviour: { failOnce: 99, transient: true },
  });
  const client = new EventsClient('https://fake', { server: fake });

  await assert.rejects(
    () => client.fetchPage(
      { type: 'contract', contractIds: ['CABC'] },
      { startLedger: 400, endLedger: 400, maxRetries: 2, retryDelayMs: 1 },
    ),
  );
});

test('EventsClient: requires at least one contractId', async () => {
  const events = makeEvents(1, 1);
  const fake = new MockSorobanServer({ events });
  const client = new EventsClient('https://fake', { server: fake });
  await assert.rejects(
    () => client.fetchPage({ type: 'contract', contractIds: [] }, { startLedger: 1, endLedger: 1 }),
    /at least one contract/,
  );
});

test('EventsClient: only accepts type=contract', async () => {
  const events = makeEvents(1, 1);
  const fake = new MockSorobanServer({ events });
  const client = new EventsClient('https://fake', { server: fake });
  await assert.rejects(
    () => client.fetchPage({ type: 'topic', contractIds: ['X'] }, { startLedger: 1, endLedger: 1 }),
    /only filter type/,
  );
});

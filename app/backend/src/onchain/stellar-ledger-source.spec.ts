import { NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StellarLedgerSource } from './stellar-ledger-source';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTRACT_ID = 'CC7BYOV6F6TFDU4K6RLL7YC4S2Q5H3T2MZW4KMEH2S6HTIVV6CEJAG7T';
const PACKAGE_ID = 'CDLZFCXSYDYD7VR37VBWWKUJWZJ36S4PKWFCBISNPNAJRVE2ZLYH5V5N';

/**
 * The value a `getEvents` call resolves to.
 *
 * `SorobanRpc.Server.getEvents` unwraps the JSON-RPC envelope for us, so this
 * mirrors the inner `result` object rather than the wire response.
 */
const RPC_PAGE = {
  events: [
    {
      ledger: 1001,
      contractId: CONTRACT_ID,
      txHash: 'a'.repeat(64),
      inSuccessfulContractCall: true,
      transactionIndex: 0,
      topic: ['package_disbursed'],
      value: {
        package_id: PACKAGE_ID,
        amount: 2500000n,
        timestamp: 1735689600n,
      },
    },
    {
      ledger: 1001,
      contractId: CONTRACT_ID,
      txHash: 'a'.repeat(64),
      inSuccessfulContractCall: true,
      transactionIndex: 1,
      topic: ['package_revoked'],
      value: {
        package_id: PACKAGE_ID,
        amount: 1000000n,
        timestamp: 1735689700n,
      },
    },
    {
      ledger: 1005,
      contractId: CONTRACT_ID,
      txHash: 'b'.repeat(64),
      inSuccessfulContractCall: true,
      transactionIndex: 0,
      topic: ['package_created_event'],
      value: {
        package_id: PACKAGE_ID,
        amount: 5000000n,
        timestamp: 1735693200n,
      },
    },
  ],
};

/** A Horizon operations collection for the contract account. */
const HORIZON_PAGE = {
  _links: {},
  _embedded: {
    records: [
      {
        id: 'op-1',
        paging_token: '12884905984',
        type: 'payment',
        ledger: 1001,
        created_at: '2025-01-01T00:00:00Z',
        transaction_hash: 'c'.repeat(64),
        transaction_successful: true,
        from: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        to: CONTRACT_ID,
        amount: '42.5000000',
        transaction_hash_set: {
          transaction_hash: 'c'.repeat(64),
          operation_index: 0,
        },
      },
      {
        id: 'op-2',
        paging_token: '12884906000',
        type: 'payment',
        ledger: 1002,
        created_at: '2025-01-01T00:05:00Z',
        transaction_hash: 'd'.repeat(64),
        transaction_successful: true,
        from: CONTRACT_ID,
        to: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        amount: '10.0000000',
        transaction_hash_set: {
          transaction_hash: 'd'.repeat(64),
          operation_index: 1,
        },
      },
      {
        id: 'op-3',
        paging_token: '12884906010',
        type: 'create_account',
        ledger: 1003,
        created_at: '2025-01-01T00:06:00Z',
        transaction_hash: 'e'.repeat(64),
        transaction_successful: true,
        from: CONTRACT_ID,
        to: null,
        amount: null,
      },
    ],
  },
  links: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function source(values: Record<string, string>): StellarLedgerSource {
  return new StellarLedgerSource(config(values));
}

/**
 * A client pinned to the Horizon operation stream.
 *
 * Horizon queries are per-account, so the contract id is not optional here: it
 * identifies whose operations are being read.
 */
function horizonSource(): StellarLedgerSource {
  return source({
    STELLAR_LEDGER_SOURCE: 'horizon',
    AID_ESCROW_CONTRACT_ID: CONTRACT_ID,
  });
}

/**
 * Ceiling for a test that must watch a retryable failure run the whole
 * 1s/2s/4s backoff ladder, which outlives the 5s Jest default.
 */
const RETRY_LADDER_TIMEOUT_MS = 20_000;

/** Stub the Soroban SDK server with a scripted `getEvents`. */
function stubRpc(pages: unknown[]): { getEvents: jest.Mock } {
  const getEvents = jest.fn();
  pages.forEach(page => getEvents.mockResolvedValueOnce(page));
  getEvents.mockResolvedValue({ events: [] });
  return { getEvents };
}

/** Install a fake `SorobanRpc.Server` on the instance. */
function withServer(instance: StellarLedgerSource, getEvents: jest.Mock): void {
  (instance as unknown as { server: unknown }).server = { getEvents };
}

/**
 * A minimal stand-in for a `Response`: the client reads `ok`, `status`,
 * `statusText` and awaits `json()`. `json` is a `Promise.resolve` rather than
 * an `async` arrow because the bodies are already values and an `async`
 * function with no `await` trips `require-await`.
 */
function fakeResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  };
}

/** Stub global fetch with a scripted response queue. */
function stubFetch(bodies: unknown[]): jest.Mock {
  const fetchMock = jest.fn();
  bodies.forEach(body => fetchMock.mockResolvedValueOnce(fakeResponse(body)));
  fetchMock.mockResolvedValue(fakeResponse({ _embedded: { records: [] } }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  return fetchMock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StellarLedgerSource', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isEnabled', () => {
    it('is available on the RPC event stream when a contract id is configured', () => {
      const client = source({ AID_ESCROW_CONTRACT_ID: CONTRACT_ID });
      expect(client.sourceKind).toBe('soroban-rpc');
      expect(client.isEnabled()).toBe(true);
    });

    it('is available on Horizon when a contract id is configured', () => {
      const client = source({
        STELLAR_LEDGER_SOURCE: 'horizon',
        AID_ESCROW_CONTRACT_ID: CONTRACT_ID,
      });
      expect(client.sourceKind).toBe('horizon');
      expect(client.isEnabled()).toBe(true);
    });

    it('is unavailable on Horizon without a contract id, because a Horizon query is per-account', () => {
      const client = source({ STELLAR_LEDGER_SOURCE: 'horizon' });
      expect(client.isEnabled()).toBe(false);
      expect(client.describeUnavailable()).toContain('AID_ESCROW_CONTRACT_ID');
    });

    it('is unavailable when the source is explicitly disabled', () => {
      const client = source({
        STELLAR_LEDGER_SOURCE: 'disabled',
        AID_ESCROW_CONTRACT_ID: CONTRACT_ID,
      });
      expect(client.isEnabled()).toBe(false);
      expect(client.describeUnavailable()).toContain('disabled');
    });

    it('is unavailable when RPC is pinned but no contract id is configured', () => {
      const client = source({ STELLAR_LEDGER_SOURCE: 'soroban-rpc' });
      expect(client.isEnabled()).toBe(false);
      expect(client.describeUnavailable()).toContain('AID_ESCROW_CONTRACT_ID');
    });
  });

  describe('fetchLedgerEntries guards', () => {
    it('raises NotImplementedException instead of reporting an empty range', async () => {
      const client = source({ STELLAR_LEDGER_SOURCE: 'disabled' });
      await expect(
        client.fetchLedgerEntries({ startLedger: 1, endLedger: 2 }),
      ).rejects.toThrow(NotImplementedException);
    });

    it('rejects a reversed range', async () => {
      const client = source({ AID_ESCROW_CONTRACT_ID: CONTRACT_ID });
      await expect(
        client.fetchLedgerEntries({ startLedger: 10, endLedger: 1 }),
      ).rejects.toThrow('startLedger must be less than or equal to endLedger');
    });

    it('rejects non-integer bounds', async () => {
      const client = source({ AID_ESCROW_CONTRACT_ID: CONTRACT_ID });
      await expect(
        client.fetchLedgerEntries({ startLedger: 1.5, endLedger: 2 }),
      ).rejects.toThrow('must be integers');
    });
  });

  describe('Soroban RPC event stream', () => {
    it('maps recorded event responses to ledger entries', async () => {
      const client = source({ AID_ESCROW_CONTRACT_ID: CONTRACT_ID });
      withServer(client, stubRpc([RPC_PAGE]).getEvents);

      const entries = await client.fetchLedgerEntries({
        startLedger: 1000,
        endLedger: 1010,
      });

      // `package_created_event` is intentionally absent: creating a package
      // moves no funds, so it has no BalanceLedger eventType to record.
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        ledger: 1001,
        eventType: 'disburse',
        amount: 2500000,
        packageId: PACKAGE_ID,
        txHash: 'a'.repeat(64),
        eventIndex: 0,
        source: 'soroban-rpc',
      });
      expect(entries[0].createdAt).toEqual(new Date('2025-01-01T00:00:00Z'));
      expect(entries.map(e => e.eventType)).toEqual(['disburse', 'unlock']);
    });

    it('scopes the event filter to the escrow contract', async () => {
      const client = source({ AID_ESCROW_CONTRACT_ID: CONTRACT_ID });
      const { getEvents } = stubRpc([RPC_PAGE]);
      withServer(client, getEvents);

      await client.fetchLedgerEntries({ startLedger: 1000, endLedger: 1010 });

      expect(getEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: [{ type: 'contract', contractIds: [CONTRACT_ID] }],
        }),
      );
    });

    it('skips events from a reverted contract call', async () => {
      const client = source({ AID_ESCROW_CONTRACT_ID: CONTRACT_ID });
      withServer(
        client,
        stubRpc([
          {
            events: [
              {
                ...RPC_PAGE.events[0],
                inSuccessfulContractCall: false,
              },
            ],
          },
        ]).getEvents,
      );

      const entries = await client.fetchLedgerEntries({
        startLedger: 1000,
        endLedger: 1010,
      });

      expect(entries).toHaveLength(0);
    });

    it('skips and warns about a topic with no ledger-event mapping', async () => {
      const client = source({ AID_ESCROW_CONTRACT_ID: CONTRACT_ID });
      withServer(
        client,
        stubRpc([
          {
            result: {
              events: [
                {
                  ledger: 1001,
                  contractId: CONTRACT_ID,
                  txHash: 'a'.repeat(64),
                  inSuccessfulContractCall: true,
                  transactionIndex: 0,
                  topic: ['some_future_event'],
                  value: { amount: 1n },
                },
              ],
            },
          },
        ]).getEvents,
      );

      const entries = await client.fetchLedgerEntries({
        startLedger: 1000,
        endLedger: 1010,
      });

      expect(entries).toHaveLength(0);
    });

    it('produces the same id for the same chain facts across runs', async () => {
      const first = source({ AID_ESCROW_CONTRACT_ID: CONTRACT_ID });
      withServer(first, stubRpc([RPC_PAGE]).getEvents);
      const a = await first.fetchLedgerEntries({
        startLedger: 1000,
        endLedger: 1010,
      });

      const second = source({ AID_ESCROW_CONTRACT_ID: CONTRACT_ID });
      withServer(second, stubRpc([RPC_PAGE]).getEvents);
      const b = await second.fetchLedgerEntries({
        startLedger: 1000,
        endLedger: 1010,
      });

      expect(a.map(e => e.id)).toEqual(b.map(e => e.id));
    });
  });

  describe('Horizon operation stream', () => {
    it('maps recorded payment operations to ledger entries', async () => {
      const client = horizonSource();
      const fetchMock = stubFetch([HORIZON_PAGE]);

      const entries = await client.fetchLedgerEntries({
        startLedger: 1000,
        endLedger: 1005,
      });

      // Incoming payment is a lock, outgoing payment is a disburse, and the
      // create_account operation moves no funds so it is dropped.
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        ledger: 1001,
        eventType: 'lock',
        amount: 42.5,
        source: 'horizon',
      });
      expect(entries[1]).toMatchObject({
        ledger: 1002,
        eventType: 'disburse',
        amount: 10,
      });
      expect(fetchMock).toHaveBeenCalled();
    });

    it('excludes operations from ledgers past the requested range', async () => {
      const client = horizonSource();
      stubFetch([
        {
          _embedded: {
            records: [
              { ...HORIZON_PAGE._embedded.records[0], ledger: 1001 },
              { ...HORIZON_PAGE._embedded.records[1], ledger: 1002 },
              {
                ...HORIZON_PAGE._embedded.records[0],
                id: 'op-9',
                ledger: 2000,
              },
            ],
          },
        },
      ]);

      const entries = await client.fetchLedgerEntries({
        startLedger: 1000,
        endLedger: 1005,
      });

      expect(entries.every(e => e.ledger <= 1005)).toBe(true);
    });

    it('stops paging when the server returns no next cursor', async () => {
      const client = horizonSource();
      const fetchMock = stubFetch([HORIZON_PAGE]);

      await client.fetchLedgerEntries({ startLedger: 1000, endLedger: 1005 });

      // One call: the fixture has no `links.next.href`.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('follows the next-page cursor when the server supplies one', async () => {
      const client = horizonSource();
      const secondPage = {
        _embedded: {
          records: [
            { ...HORIZON_PAGE._embedded.records[0], id: 'op-4', ledger: 1004 },
          ],
        },
      };
      const firstPage = {
        ...HORIZON_PAGE,
        links: {
          next: {
            href: 'https://horizon.testnet.stellar.org/x?cursor=12884905984',
          },
        },
      };
      const fetchMock = stubFetch([firstPage, secondPage]);

      const entries = await client.fetchLedgerEntries({
        startLedger: 1000,
        endLedger: 1005,
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(entries).toHaveLength(3);
    });

    it(
      'fails the read when Horizon returns a non-2xx response',
      async () => {
        const client = horizonSource();
        const fetchMock = jest.fn().mockResolvedValue({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: () => Promise.resolve({}),
        });
        (global as unknown as { fetch: unknown }).fetch = fetchMock;

        await expect(
          client.fetchLedgerEntries({ startLedger: 1000, endLedger: 1005 }),
        ).rejects.toThrow(/503/);

        // A 503 is retryable, so exhausting the ladder is the correct outcome
        // rather than surfacing on the first attempt.
        expect(fetchMock).toHaveBeenCalledTimes(4);
      },
      RETRY_LADDER_TIMEOUT_MS,
    );
  });
});

'use strict';

/**
 * Soroban RPC event fetcher.
 *
 * Wraps `Server.getEvents` with pagination (`cursor` follows), exponential
 * backoff retry on transient errors, and a deterministic in-memory mock for
 * tests.
 *
 * Soroban RPC's `getEvents` has a max page size (defaults vary; SDK exposes
 * limit=10k, the network may return up to ~100 events per call). For long
 * ranges we iterate by `cursor` until the page returns fewer than the limit
 * (the SDK signals this with `events.length < limit`).
 */

const { rpc: SorobanRpc } = require('@stellar/stellar-sdk');

/**
 * @typedef {Object} EventFilter
 * @property {'contract'} type   Filter type (Soroban RPC only supports 'contract')
 * @property {string[]} contractIds  Required when type='contract'
 * @property {string[]} [topics]    Optional topic filter
 */

/**
 * @typedef {Object} FetchOptions
 * @property {number} startLedger
 * @property {number} endLedger
 * @property {number} [limit=500]   Max events per page (SDK/network dependent)
 * @property {string} [cursor]      Resume cursor
 * @property {number} [maxRetries=5]
 * @property {number} [retryDelayMs=500]
 * @property {number} [rpcTimeoutMs=30000]
 * @property {(stats: {attempt:number,delay:number,err:string}) => void} [onRetry]
 */

/**
 * @typedef {Object} FetchPageResult
 * @property {any[]} events
 * @property {string|null} cursor  When non-null, more pages remain in the requested range.
 * @property {{ attempts:number, retries:number }} stats
 */

/**
 * Build a JSON-RPC client for Soroban.
 * @param {string} rpcUrl
 */
function makeRpcClient(rpcUrl) {
  const allowHttp = typeof rpcUrl === 'string' && rpcUrl.startsWith('http://');
  return new SorobanRpc.Server(rpcUrl, { allowHttp });
}

/**
 * Sleep helper.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyTransient(err) {
  const msg = String(err && err.message ? err.message : err);
  // Heuristic, not exhaustive — fails open: any error is retried up to maxRetries.
  if (
    /ETIMEDOUT|ENOTFOUND|ECONNRESET|ECONNREFUSED|socket hang up|timeout|rate/i.test(msg)
  ) {
    return true;
  }
  return false;
}

class EventsClient {
  /**
   * @param {string} rpcUrl  Soroban RPC endpoint (https).
   * @param {{ server?: any }} [opts]  Inject a custom Server (used by tests).
   */
  constructor(rpcUrl, opts = {}) {
    if (typeof rpcUrl !== 'string' || rpcUrl.length === 0) {
      throw new Error('rpcUrl is required');
    }
    this.rpcUrl = rpcUrl;
    this.server = opts.server || makeRpcClient(rpcUrl);
  }

  /**
   * Run the configured server's getEvents() under a timeout.
   * The timeout is cleared once either side of the race resolves, so the
   * process can exit cleanly without a pending setTimeout.
   * @private
   */
  async #callGetEvents(filter, opts) {
    const call = this.server.getEvents({
      startLedger: opts.startLedger,
      endLedger: opts.endLedger,
      cursor: opts.cursor,
      limit: opts.limit,
      filters: [filter],
    });
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`RPC timeout after ${opts.rpcTimeoutMs}ms`)),
        opts.rpcTimeoutMs,
      );
    });
    try {
      return await Promise.race([call, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Fetch a single page of events, retrying transient errors with exponential backoff.
   * @param {EventFilter} filter
   * @param {FetchOptions} opts
   * @returns {Promise<FetchPageResult>}
   */
  async fetchPage(filter, opts) {
    if (!filter || filter.type !== 'contract') {
      throw new Error("only filter type 'contract' is supported");
    }
    if (!Array.isArray(filter.contractIds) || filter.contractIds.length === 0) {
      throw new Error('at least one contractId is required');
    }
    const limit = opts.limit ?? 500;
    const maxRetries = opts.maxRetries ?? 5;
    const retryDelayMs = opts.retryDelayMs ?? 500;
    const rpcTimeoutMs = opts.rpcTimeoutMs ?? 30000;

    let attempt = 0;
    let retries = 0;
    let lastError;
    while (attempt <= maxRetries) {
      try {
        const resp = await this.#callGetEvents(filter, {
          ...opts,
          limit,
          rpcTimeoutMs,
        });
        const events = Array.isArray(resp && resp.events) ? resp.events : [];
        // SDK returns a `cursor` when more pages remain. Some SDK builds return
        // undefined/null once exhausted.
        return {
          events,
          cursor: resp && resp.cursor ? String(resp.cursor) : null,
          stats: { attempts: attempt + 1, retries },
        };
      } catch (err) {
        lastError = err;
        if (attempt >= maxRetries || !classifyTransient(err)) {
          throw err;
        }
        retries += 1;
        const delay = Math.min(retryDelayMs * Math.pow(2, attempt), 30000);
        if (typeof opts.onRetry === 'function') {
          try {
            opts.onRetry({ attempt: attempt + 1, delay, err: String(err.message || err) });
          } catch (_) {
            /* ignore logger errors */
          }
        }
        await sleep(delay);
        attempt += 1;
      }
    }
    throw lastError;
  }

  /**
   * Fetch all events in `[startLedger..endLedger]` (inclusive), paging via cursor.
   * Emits each event through `onEvent` (the caller typically writes NDJSON).
   *
   * @param {EventFilter} filter
   * @param {FetchOptions & { onEvent: (e:any)=>void }} opts
   * @returns {Promise<{ events: number, batches: number, retries: number }>}
   */
  async fetchAll(filter, opts) {
    if (typeof opts.onEvent !== 'function') {
      throw new Error('onEvent callback is required');
    }
    let cursor = opts.cursor || undefined;
    let events = 0;
    let batches = 0;
    let retries = 0;
    // Safety guard: don't loop forever on a misbehaving server.
    const MAX_PAGES = 100000;
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const result = await this.fetchPage(filter, { ...opts, cursor });
      batches += 1;
      retries += result.stats.retries;
      for (const ev of result.events) {
        events += 1;
        opts.onEvent(ev);
      }
      if (!result.cursor) break;
      cursor = result.cursor;
    }
    return { events, batches, retries };
  }
}

/**
 * Minimal in-memory mock of SorobanRpc.Server for offline tests.
 *
 * Behaviour: returns a deterministic list of events per ledger in the requested
 * window, paginated by `limit`. Supports cursor continuation.
 */
class MockSorobanServer {
  /**
   * @param {Object} cfg
   * @param {Array<{ledger:number,eventType:string,contractId:string,topics:string[],data:any}>} cfg.events
   *   Pre-built linear array. Server slices by ledger and returns pages of `limit` events.
   * @param {{ failOnce?: number, transient?: boolean }} [cfg.behaviour]
   */
  constructor(cfg) {
    if (!cfg || !Array.isArray(cfg.events)) {
      throw new Error('MockSorobanServer requires events[]');
    }
    this.events = cfg.events.slice().sort((a, b) => a.ledger - b.ledger);
    this.failsLeft = cfg.behaviour?.failOnce || 0;
    this.transient = !!cfg.behaviour?.transient;
    // Bookkeeping for tests.
    this.calls = 0;
  }

  async getEvents(req) {
    this.calls += 1;
    if (this.failsLeft > 0) {
      this.failsLeft -= 1;
      const err = new Error(this.transient ? 'connect ETIMEDOUT (mock)' : 'mock hard failure');
      throw err;
    }
    // Compute cursor pointer — simplest impl is "index of the next event to return".
    const startIdx = req.cursor ? parseInt(req.cursor, 10) || 0 : 0;
    const window = this.events.filter(
      (e) => e.ledger >= req.startLedger && e.ledger <= req.endLedger,
    );
    const page = window.slice(startIdx, startIdx + (req.limit || 100));
    const next = startIdx + page.length;
    const cursor = next < window.length ? String(next) : undefined;
    return { events: page, cursor };
  }
}

module.exports = { EventsClient, MockSorobanServer };

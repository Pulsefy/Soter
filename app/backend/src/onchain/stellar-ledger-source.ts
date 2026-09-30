import {
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { rpc as SorobanRpc, scValToNative } from '@stellar/stellar-sdk';
import { getNetworkProfile } from '../../config/network.config';
import { withRetryTimeout } from './utils/retry-with-timeout';

/**
 * A movement of escrowed funds, normalised from whichever Stellar source
 * reported it.
 *
 * This is the single shape both the reconciliation and backfill jobs consume,
 * which is the point of the client: the two jobs used to keep private
 * placeholder stubs of the same idea and drift apart from the chain.
 */
export interface OnChainLedgerEntry {
  /**
   * Deterministic identity of the on-chain movement, derived from facts the
   * chain owns (contract, ledger, package, topic) rather than assigned locally,
   * so two runs over the same range produce the same ids and the comparison is
   * stable.
   */
  id: string;
  ledger: number;
  /**
   * Amount in the token's base unit, widened to `number` because
   * `BalanceLedger.amount` is a float.
   */
  amount: number;
  /**
   * `BalanceLedger.eventType` vocabulary. `lock` when funds become committed,
   * `disburse` when they leave to a recipient, `unlock` when a commitment is
   * released without being paid.
   */
  eventType: 'lock' | 'unlock' | 'disburse';
  /** On-chain package id, when the movement is package-scoped. */
  packageId?: string;
  /** Ledger close time of the reported movement. */
  createdAt: Date;
  /** Transaction hash, for tracing an entry back to the chain. */
  txHash: string;
  /** Index of the event within its transaction, disambiguating batch moves. */
  eventIndex: number;
  /** Which source produced this entry. */
  source: LedgerSourceKind;
}

/** Identifies where a range of ledger data is read from. */
export type LedgerSourceKind = 'soroban-rpc' | 'horizon';

/** Inclusive ledger range to read. */
export interface LedgerRange {
  startLedger: number;
  endLedger: number;
}

export interface FetchLedgerEntriesParams extends LedgerRange {
  /**
   * Contract to read events from. Defaults to `AID_ESCROW_CONTRACT_ID`.
   * Required for the `soroban-rpc` source.
   */
  contractId?: string;
}

/**
 * Maps `aid_escrow` contract event topics onto the `BalanceLedger.eventType`
 * vocabulary.
 *
 * Every topic is assigned rather than filtered: an unmapped topic means the
 * contract grew a new money-moving path that reconciliation has never been
 * taught about, and silently dropping it would reintroduce exactly the blind
 * spot this client exists to remove. Unknown topics are skipped and logged.
 */
const EVENT_TOPIC_TO_LEDGER_TYPE: Readonly<
  Record<string, OnChainLedgerEntry['eventType']>
> = {
  escrow_funded: 'lock',
  package_created: 'lock',
  batch_created_event: 'lock',
  package_claimed: 'disburse',
  package_claimed_by_relayer: 'disburse',
  package_disbursed: 'disburse',
  package_revoked: 'unlock',
  package_refunded: 'unlock',
  package_swept: 'unlock',
};

/**
 * Reads genuine ledger data for the reconciliation and backfill jobs from a
 * Stellar network.
 *
 * Two sources are supported because they answer different questions:
 *
 * - `soroban-rpc` reads the escrow contract's own event stream via the RPC
 *   node's `getEvents`. This is the authoritative record of what the contract
 *   did to escrowed funds and is the default whenever a contract id is
 *   configured.
 * - `horizon` reads the escrow contract account's operation stream over REST.
 *   Horizon does not index contract events, so this only recovers classic
 *   Stellar payments to and from the contract account; it is the fallback for
 *   deployments where the RPC node cannot serve `getEvents`.
 *
 * `STELLAR_LEDGER_SOURCE` pins the choice. Left on `auto`, the client uses
 * `soroban-rpc` when a contract id is configured and `horizon` otherwise.
 *
 * When neither source can serve live data — an explicit `disabled` setting, or
 * no contract id on a node expected to provide `getEvents` — {@link
 * isEnabled} reports false and {@link fetchLedgerEntries} raises
 * {@link NotImplementedException}. Callers surface that instead of reporting
 * an always-passing reconciliation.
 */
@Injectable()
export class StellarLedgerSource {
  private readonly logger = new Logger(StellarLedgerSource.name);

  private readonly rpcUrl: string;
  private readonly horizonUrl: string;
  private readonly contractId: string;
  private readonly requestedSource: 'auto' | LedgerSourceKind | 'disabled';
  private server: SorobanRpc.Server | null = null;

  constructor(private readonly configService: ConfigService) {
    const network = this.configService.get<string>('SOROBAN_NETWORK');
    const profile = getNetworkProfile(network);

    this.rpcUrl = this.configService.get<string>(
      'STELLAR_RPC_URL',
      profile.defaultRpcUrl,
    );
    this.horizonUrl = this.configService
      .get<string>('STELLAR_HORIZON_URL', profile.defaultHorizonUrl)
      .replace(/\/+$/, '');
    this.contractId = this.configService.get<string>('AID_ESCROW_CONTRACT_ID', '');

    const configured = (
      this.configService.get<string>('STELLAR_LEDGER_SOURCE') ?? 'auto'
    )
      .trim()
      .toLowerCase();

    if (
      configured === 'soroban-rpc' ||
      configured === 'horizon' ||
      configured === 'disabled'
    ) {
      this.requestedSource = configured;
    } else {
      if (configured !== 'auto') {
        this.logger.warn(
          `STELLAR_LEDGER_SOURCE="${configured}" is not recognised; falling back to "auto"`,
        );
      }
      this.requestedSource = 'auto';
    }
  }

  /** Which source this instance will actually use, resolving `auto`. */
  get sourceKind(): LedgerSourceKind | 'disabled' {
    if (this.requestedSource === 'disabled') {
      return 'disabled';
    }
    if (this.requestedSource !== 'auto') {
      return this.requestedSource;
    }
    return this.contractId ? 'soroban-rpc' : 'horizon';
  }

  /**
   * False when this client cannot serve live data.
   *
   * `horizon` is always available because the public endpoint needs no
   * configuration; `soroban-rpc` needs a contract id to scope the event
   * filter, and `disabled` is never available.
   */
  isEnabled(): boolean {
    const kind = this.sourceKind;
    if (kind === 'disabled') {
      return false;
    }
    if (kind === 'horizon') {
      return this.horizonUrl.length > 0;
    }
    return this.contractId.length > 0;
  }

  /**
   * Explain, in operator-facing terms, why live ledger data is unavailable.
   */
  describeUnavailable(): string {
    const kind = this.sourceKind;
    if (kind === 'disabled') {
      return 'STELLAR_LEDGER_SOURCE is set to "disabled".';
    }
    if (kind === 'soroban-rpc' && !this.contractId) {
      return 'AID_ESCROW_CONTRACT_ID is not set, so the escrow contract event stream cannot be scoped.';
    }
    if (!this.horizonUrl && kind === 'horizon') {
      return 'STELLAR_HORIZON_URL is not set.';
    }
    return 'The Stellar ledger source is available.';
  }

  private getServer(): SorobanRpc.Server {
    if (!this.server) {
      this.server = new SorobanRpc.Server(this.rpcUrl, {
        allowHttp: this.rpcUrl.startsWith('http://'),
      });
    }
    return this.server;
  }

  /**
   * Read every escrow money movement in `[startLedger, endLedger]`, newest
   * source last. Ordering is by ledger then event index so a diff of two runs
   * over the same range is meaningful.
   */
  async fetchLedgerEntries(
    params: FetchLedgerEntriesParams,
  ): Promise<OnChainLedgerEntry[]> {
    const { startLedger, endLedger } = params;

    if (!Number.isInteger(startLedger) || !Number.isInteger(endLedger)) {
      throw new Error('startLedger and endLedger must be integers');
    }
    if (startLedger > endLedger) {
      throw new Error('startLedger must be less than or equal to endLedger');
    }
    if (!this.isEnabled()) {
      throw new NotImplementedException(
        `Live on-chain ledger data is not available: ${this.describeUnavailable()} ` +
          'Set AID_ESCROW_CONTRACT_ID (and STELLAR_RPC_URL / STELLAR_HORIZON_URL) ' +
          'to reconcile or backfill against real chain data.',
      );
    }

    const kind = this.sourceKind;
    const entries =
      kind === 'soroban-rpc'
        ? await this.fetchFromSorobanRpc(params)
        : await this.fetchFromHorizon({ startLedger, endLedger });

    this.logger.log(
      `Fetched ${entries.length} on-chain ledger entries for ledgers ${startLedger}-${endLedger} via ${kind}`,
    );

    return entries.sort(
      (a, b) => a.ledger - b.ledger || a.eventIndex - b.eventIndex,
    );
  }

  /**
   * Read the escrow contract's event stream.
   *
   * `getEvents` caps a single response, so the range is walked in
   * {@link EVENT_PAGE_SIZE}-ledger windows; that bound also keeps each RPC
   * node request well inside its own limit.
   */
  private async fetchFromSorobanRpc(
    params: FetchLedgerEntriesParams,
  ): Promise<OnChainLedgerEntry[]> {
    const contractId = params.contractId?.trim() || this.contractId;
    if (!contractId) {
      throw new NotImplementedException(
        'AID_ESCROW_CONTRACT_ID is required to read the escrow contract event stream.',
      );
    }

    const filter: SorobanRpc.Api.EventFilter = {
      type: 'contract',
      contractIds: [contractId],
    };

    const entries: OnChainLedgerEntry[] = [];
    const server = this.getServer();

    for (
      let startLedger = params.startLedger;
      startLedger <= params.endLedger;
      startLedger += EVENT_PAGE_SIZE
    ) {
      const endLedger = Math.min(
        startLedger + EVENT_PAGE_SIZE - 1,
        params.endLedger,
      );

      const response = await withRetryTimeout(
        () =>
          server.getEvents({
            filters: [filter],
            startLedger,
            endLedger,
            limit: EVENT_PAGE_SIZE,
          }),
        `getEvents(${contractId}, ${startLedger}-${endLedger})`,
        `ledger-source-${startLedger}`,
        { maxRetries: 3, baseDelayMs: 1000, operationTimeoutMs: 60000 },
        this.logger,
      );

      for (const event of response.events ?? []) {
        const entry = this.mapSorobanEvent(event, contractId);
        if (entry) {
          entries.push(entry);
        }
      }
    }

    return entries;
  }

  /**
   * Decode one contract event into a ledger entry, or `null` when the topic
   * does not move escrowed funds.
   */
  private mapSorobanEvent(
    event: {
      contractId?: string;
      txHash?: string;
      ledger?: number;
      transactionIndex?: number;
      inSuccessfulContractCall?: boolean;
      topic?: unknown[];
      value?: unknown;
    },
    fallbackContractId: string,
  ): OnChainLedgerEntry | null {
    // Events emitted by a reverted call are rolled back on-chain; recording one
    // would invent a movement that never happened.
    if (event.inSuccessfulContractCall === false) {
      return null;
    }

    const topic = decodeTopic(event.topic);
    if (!topic) {
      return null;
    }

    const eventType = EVENT_TOPIC_TO_LEDGER_TYPE[topic];
    if (!eventType) {
      this.logger.warn(
        `Ignoring on-chain event "${topic}": not mapped to a BalanceLedger eventType`,
      );
      return null;
    }

    const payload = decodePayload(event.value);
    const ledger = Number(event.ledger ?? 0);
    const contractId = String(event.contractId ?? fallbackContractId);
    const packageId = readStringField(payload, 'package_id');

    return {
      id: buildEntryId({ contractId, ledger, packageId, topic }),
      ledger,
      amount: readAmountAsNumber(payload),
      eventType,
      packageId,
      createdAt: ledgerTimestampFrom(payload),
      txHash: String(event.txHash ?? ''),
      eventIndex: Number(event.transactionIndex ?? 0),
      source: 'soroban-rpc',
    };
  }

  /**
   * Read the escrow contract account's classic operation stream over Horizon.
   *
   * Horizon does not index contract events, so this only yields entries for
   * payments involving the contract account: incoming payments lock funds into
   * the pool, outgoing payments disburse or release them. Operations outside a
   * ledger that has already closed are excluded so the caller never reconciles
   * against a ledger the chain has not settled.
   */
  private async fetchFromHorizon(
    range: LedgerRange,
  ): Promise<OnChainLedgerEntry[]> {
    if (!this.contractId) {
      throw new NotImplementedException(
        'AID_ESCROW_CONTRACT_ID is required to read the escrow contract account operation stream.',
      );
    }

    const entries: OnChainLedgerEntry[] = [];

    for (
      let cursorLedger = range.startLedger;
      cursorLedger <= range.endLedger;
      cursorLedger += HORIZON_PAGE_SIZE
    ) {
      const endLedger = Math.min(
        cursorLedger + HORIZON_PAGE_SIZE - 1,
        range.endLedger,
      );

      const records = await this.requestHorizonPage(cursorLedger, endLedger);

      for (const record of records) {
        const entry = this.mapHorizonOperation(record);
        if (entry) {
          entries.push(entry);
        }
      }
    }

    return entries;
  }

  /**
   * Fetch one page of the contract account's operations for a ledger window.
   *
   * Stellar's paging is cursor-based rather than range-based: `cursor` is
   * exclusive and `order=asc` walks forward, so the first request anchors on
   * `startLedger - 1` and paging follows the server's `paging_token` until it
   * passes `endLedger` or the server runs out of records.
   */
  private async requestHorizonPage(
    startLedger: number,
    endLedger: number,
  ): Promise<HorizonOperationRecord[]> {
    const records: HorizonOperationRecord[] = [];
    let cursor = String(Math.max(0, startLedger - 1));
    const correlationId = `ledger-source-horizon-${startLedger}`;

    // Bounded so a misconfigured range cannot spin forever against an endpoint
    // that keeps handing back the same token.
    for (let page = 0; page < HORIZON_MAX_PAGES_PER_WINDOW; page++) {
      const url =
        `${this.horizonUrl}/accounts/${encodeURIComponent(this.contractId)}` +
        `/operations?order=asc&cursor=${encodeURIComponent(cursor)}` +
        `&limit=${HORIZON_PAGE_SIZE}&include_failed=false`;

      const body = await withRetryTimeout(
        () => this.getJson(url),
        `horizon operations(${startLedger}-${endLedger})`,
        correlationId,
        { maxRetries: 3, baseDelayMs: 1000, operationTimeoutMs: 60000 },
        this.logger,
      );

      const batch = readHorizonRecords(body);

      for (const record of batch) {
        if (Number(record.ledger ?? 0) > endLedger) {
          return records;
        }
        records.push(record);
      }

      const nextCursor = readPagingCursor(body);
      if (!batch.length || !nextCursor || nextCursor === cursor) {
        return records;
      }
      cursor = nextCursor;
    }

    return records;
  }

  /** GET a Horizon endpoint, failing on any non-2xx response. */
  private async getJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(
        `Horizon request failed with ${response.status} ${response.statusText}`,
      );
    }

    return response.json();
  }

  /**
   * Map one Horizon operation to a ledger entry, or `null` when the operation
   * does not move funds into or out of the escrow contract account.
   */
  private mapHorizonOperation(
    record: HorizonOperationRecord,
  ): OnChainLedgerEntry | null {
    if (record.type !== 'payment' || record.transaction_successful === false) {
      return null;
    }

    const ledger = Number(record.ledger ?? 0);
    const outgoing = record.to === this.contractId;
    const incoming = record.from === this.contractId;
    if (!outgoing && !incoming) {
      return null;
    }

    // A transfer path identifier makes the id stable across re-runs: the hash
    // plus the operation index pins the move to one operation within one
    // transaction. Falls back to the paging token when the endpoint omits the
    // link, which Horizon does for a few operation types.
    const txSet = record.transaction_hash_set;
    const discriminator = txSet
      ? `${txSet.transaction_hash ?? ''}#${txSet.operation_index ?? 0}`
      : String(record.paging_token ?? record.id ?? '');

    const eventType: OnChainLedgerEntry['eventType'] = incoming
      ? 'lock'
      : 'disburse';

    return {
      id: `horizon:${this.contractId}:${ledger}:${eventType}:${discriminator}`,
      ledger,
      amount: Number(record.amount ?? 0),
      eventType,
      createdAt: record.created_at ? new Date(record.created_at) : new Date(0),
      txHash: String(record.transaction_hash ?? ''),
      eventIndex: 0,
      source: 'horizon',
    };
  }
}

/** Ledger window per `getEvents` call. */
const EVENT_PAGE_SIZE = 1000;

/** Horizon `limit` per operations request. */
const HORIZON_PAGE_SIZE = 200;

/** Ledger window a single Horizon paging walk covers. */
const HORIZON_MAX_PAGES_PER_WINDOW = 50;

/** The subset of a Horizon operation record this client reads. */
interface HorizonOperationRecord {
  id?: string;
  paging_token?: string;
  type?: string;
  ledger?: number;
  created_at?: string;
  transaction_hash?: string;
  transaction_successful?: boolean;
  from?: string;
  to?: string;
  amount?: string;
  transaction_hash_set?: { transaction_hash?: string; operation_index?: number };
}

/**
 * Pull the operation records out of a Horizon collection envelope.
 *
 * Horizon always wraps collections in `_embedded.records`, but an exhausted
 * collection omits `_embedded` entirely, so both shapes are handled.
 */
function readHorizonRecords(body: unknown): HorizonOperationRecord[] {
  if (typeof body !== 'object' || body === null) {
    return [];
  }
  const records = (body as { _embedded?: { records?: unknown } })._embedded
    ?.records;
  return Array.isArray(records) ? (records as HorizonOperationRecord[]) : [];
}

/** Pull the next page cursor out of a Horizon collection envelope. */
function readPagingCursor(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const links = (body as { links?: { next?: { href?: string } } }).links;
  const href = links?.next?.href;
  if (!href) {
    return null;
  }
  try {
    return new URL(href).searchParams.get('cursor');
  } catch {
    return null;
  }
}

/**
 * Read the topic name from an event's topic tuple.
 *
 * `xdr.ScVal` values are decoded through `scValToNative`, which yields the
 * symbol's string form. Payloads in fixtures or hand-built responses may
 * already be decoded, so both shapes are accepted.
 */
function decodeTopic(topic: unknown[] | undefined): string | null {
  const first = topic?.[0];
  if (first === undefined || first === null) {
    return null;
  }
  if (typeof first === 'string') {
    return first;
  }
  try {
    const native = scValToNative(first as never);
    return typeof native === 'string' ? native : null;
  } catch {
    return null;
  }
}

/** Decode an event payload, tolerating an already-decoded value. */
function decodePayload(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value === 'object' && !('toXDR' in (value as object))) {
    const decoded = value as Record<string, unknown>;
    return decoded instanceof Map ? Object.fromEntries(decoded) : decoded;
  }
  try {
    const native = scValToNative(value as never);
    if (native instanceof Map) {
      return Object.fromEntries(native);
    }
    if (typeof native === 'object' && native !== null) {
      return native as Record<string, unknown>;
    }
  } catch {
    // Fall through to the empty payload below.
  }
  return {};
}

/** Read a field from a decoded event payload as a trimmed string. */
function readStringField(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = payload[field];
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/**
 * Read an `i128` amount off a payload and widen it to a `number`.
 *
 * `BalanceLedger.amount` is a float, so values beyond 2^53 cannot be held
 * exactly either way; the widening is kept in one place so every consumer
 * rounds the same amount the same way.
 */
function readAmountAsNumber(payload: Record<string, unknown>): number {
  const raw = payload.amount;
  if (typeof raw === 'bigint') {
    return Number(raw);
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Resolve the movement's ledger close time.
 *
 * The contract's events carry `timestamp` for most topics; where one does not,
 * the caller gets the epoch rather than the current wall clock, so a re-run
 * over the same range stays byte-identical.
 */
function ledgerTimestampFrom(payload: Record<string, unknown>): Date {
  const raw = payload.timestamp;
  if (typeof raw === 'bigint') {
    return new Date(Number(raw) * 1000);
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return new Date(raw * 1000);
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) {
      return new Date(parsed * 1000);
    }
  }
  return new Date(0);
}

/**
 * Build the deterministic id for an on-chain movement.
 *
 * Everything in the id comes from the chain, so two runs over the same ledger
 * range produce the same ids and `processReconciliation` can tell a genuinely
 * missing row from a re-indexed one.
 */
export function buildEntryId(parts: {
  contractId: string;
  ledger: number;
  packageId?: string;
  topic: string;
}): string {
  return [
    parts.contractId,
    parts.ledger,
    parts.packageId ?? 'pool',
    parts.topic,
  ].join(':');
}

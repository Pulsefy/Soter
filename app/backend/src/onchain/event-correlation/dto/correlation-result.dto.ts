/**
 * Result returned by the event correlation process, summarising what
 * happened during a single correlation run.
 */
export interface CorrelationResult {
  /** Total number of events fetched from the Soroban RPC */
  fetched: number;
  /** Number of events successfully mapped and persisted */
  correlated: number;
  /** Number of new OnChainEvent rows created */
  inserted: number;
  /** Number of existing OnChainEvent rows updated */
  updated: number;
  /** The first ledger number included in this run */
  startLedger: number;
  /** The last ledger number included in this run */
  endLedger: number;
  /** Present when the run encountered an error (e.g. RPC unreachable) */
  error?: string;
}

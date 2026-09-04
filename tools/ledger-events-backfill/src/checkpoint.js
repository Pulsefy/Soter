'use strict';

/**
 * Atomic, file-based checkpoint persistence.
 *
 * The CLI calls `Checkpoint.begin()` on startup, then `Checkpoint.complete(batch)` after
 * every successfully persisted batch. On restart, `Checkpoint.begin()` re-reads the file
 * and returns the latest `lastLedgerCompleted`, allowing the orchestrator to resume from
 * `lastLedgerCompleted + 1`.
 *
 * Atomicity is provided by writing to `<path>.tmp` first and then renaming — a power
 * loss between writes cannot corrupt the checkpoint.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

class CheckpointError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckpointError';
  }
}

/**
 * @typedef {Object} CheckpointState
 * @property {number} [lastLedgerCompleted]   Last ledger that has been fully processed.
 *                                            Undefined when starting fresh.
 * @property {number} totalEvents             Running tally of events emitted across all batches.
 * @property {number} totalBatches            Running tally of completed batches.
 * @property {number} totalRetries            Running tally of RPC retries.
 * @property {string} startedAt               ISO-8601 timestamp of the first write.
 * @property {string} updatedAt               ISO-8601 timestamp of the most recent write.
 * @property {string} rpcUrl                  Soroban RPC URL recorded for reproducibility.
 * @property {string[]} contractIds           Contract IDs filtered on.
 * @property {string} filterType              Event filter type (e.g. "contract").
 * @property {number} startLedger             Original requested start (inclusive).
 * @property {number} endLedger               Original requested end (inclusive).
 * @property {number} batchSize               Configured batch size.
 * @property {string} status                  "in_progress" | "completed".
 */

/**
 * @param {string} checkpointPath Absolute path on disk.
 */
class Checkpoint {
  /**
   * @param {string} checkpointPath - File path. Created lazily on first write.
   */
  constructor(checkpointPath) {
    if (typeof checkpointPath !== 'string' || checkpointPath.length === 0) {
      throw new CheckpointError('checkpoint path must be a non-empty string');
    }
    this.path = checkpointPath;
    /** @type {CheckpointState | null} */
    this.state = null;
  }

  /**
   * Load (or initialize) the checkpoint. Returns the state object.
   * @param {Object} meta - Static metadata seeded into a brand-new checkpoint.
   * @returns {Promise<CheckpointState>}
   */
  async begin(meta) {
    if (!meta || typeof meta !== 'object') {
      throw new CheckpointError('meta must be an object');
    }
    for (const key of ['startLedger', 'endLedger', 'batchSize', 'rpcUrl']) {
      if (meta[key] === undefined || meta[key] === null) {
        throw new CheckpointError(`meta.${key} is required`);
      }
    }

    const existing = await this.#read();
    if (existing) {
      // Validate that the existing checkpoint matches the current run's intent.
      this.#assertCompatible(existing, meta);
      this.state = existing;
      // Touch updatedAt so callers see a fresh access.
      this.state.updatedAt = new Date().toISOString();
      return this.state;
    }

    this.state = {
      lastLedgerCompleted: undefined,
      totalEvents: 0,
      totalBatches: 0,
      totalRetries: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rpcUrl: meta.rpcUrl,
      contractIds: meta.contractIds || [],
      filterType: meta.filterType || 'contract',
      startLedger: meta.startLedger,
      endLedger: meta.endLedger,
      batchSize: meta.batchSize,
      status: 'in_progress',
    };
    await this.#flush();
    return this.state;
  }

  /**
   * Mark a batch as complete and atomically persist.
   *
   * Idempotent: re-completing the same batch is a no-op.
   *
   * @param {number} lastLedgerInBatch - Highest ledger in the just-completed batch.
   * @param {{ events?: number, retries?: number }} [tally]
   *   - events: events emitted in this batch (added to running total)
   *   - retries: retries incurred in this batch (added to running total)
   * @returns {Promise<CheckpointState>}
   */
  async complete(lastLedgerInBatch, tally = {}) {
    if (!this.state) {
      throw new CheckpointError('checkpoint not initialised — call begin() first');
    }
    if (!Number.isInteger(lastLedgerInBatch) || lastLedgerInBatch < 0) {
      throw new CheckpointError('lastLedgerInBatch must be a non-negative integer');
    }
    if (this.state.lastLedgerCompleted !== undefined &&
        lastLedgerInBatch <= this.state.lastLedgerCompleted) {
      // Idempotent re-call after restart — keep counters but don't rewind lastLedger.
      if (tally.events) this.state.totalEvents += tally.events;
      if (tally.retries) this.state.totalRetries += tally.retries;
      this.state.updatedAt = new Date().toISOString();
      await this.#flush();
      return this.state;
    }

    this.state.lastLedgerCompleted = lastLedgerInBatch;
    this.state.totalBatches += 1;
    if (tally.events) this.state.totalEvents += tally.events;
    if (tally.retries) this.state.totalRetries += tally.retries;
    this.state.updatedAt = new Date().toISOString();

    if (this.state.lastLedgerCompleted >= this.state.endLedger) {
      this.state.status = 'completed';
    }
    await this.#flush();
    return this.state;
  }

  /**
   * Mark the checkpoint as failed (status=failed) without deleting progress.
   * Used when an unrecoverable error is hit but partial progress should be inspectable.
   * @param {string} reason
   */
  async markFailed(reason) {
    if (!this.state) return;
    this.state.status = 'failed';
    this.state.lastError = String(reason || '').slice(0, 500);
    this.state.updatedAt = new Date().toISOString();
    await this.#flush();
  }

  /**
   * Reset to a fresh checkpoint. Used by --reset or tests.
   * @returns {Promise<void>}
   */
  async reset() {
    this.state = null;
    await fsp.unlink(this.path).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  /**
   * Highest ledger already completed (0 when fresh).
   * Returns `startLedger - 1` when no batches have been processed, so callers can
   * compute the resume point as `resumeLedger = lastLedgerCompleted + 1`.
   * @returns {number}
   */
  resumeLedger() {
    if (!this.state || this.state.lastLedgerCompleted === undefined) {
      return this.state ? this.state.startLedger - 1 : 0;
    }
    return this.state.lastLedgerCompleted;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * @returns {Promise<CheckpointState | null>}
   * @private
   */
  async #read() {
    try {
      const raw = await fsp.readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      // Basic shape check.
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof parsed.startLedger !== 'number' ||
        typeof parsed.endLedger !== 'number'
      ) {
        throw new CheckpointError(`invalid checkpoint shape in ${this.path}`);
      }
      return parsed;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      // Corrupt JSON is treated as "no checkpoint" — the user is warned by the CLI
      // so they can recover manually.
      throw err;
    }
  }

  /**
   * @private
   */
  async #flush() {
    const dir = path.dirname(this.path);
    await fsp.mkdir(dir, { recursive: true });
    const tmpPath = `${this.path}.tmp`;
    await fsp.writeFile(tmpPath, JSON.stringify(this.state, null, 2), {
      mode: 0o600,
      encoding: 'utf8',
    });
    await fsp.rename(tmpPath, this.path);
  }

  /**
   * Validate that an existing checkpoint is compatible with the new run's intent.
   *
   * We refuse to silently swap contexts — a checkpoint for ledger `100-200` cannot be
   * reused for `300-400`, etc.
   *
   * @private
   */
  #assertCompatible(existing, meta) {
    const checks = {
      startLedger: existing.startLedger === meta.startLedger,
      endLedger: existing.endLedger === meta.endLedger,
      batchSize: existing.batchSize === meta.batchSize,
      rpcUrl: existing.rpcUrl === meta.rpcUrl,
      filterType: (existing.filterType || 'contract') === (meta.filterType || 'contract'),
    };
    const mismatched = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
    if (mismatched.length > 0) {
      throw new CheckpointError(
        `checkpoint at ${this.path} is for a different run (${mismatched.join(', ')}). ` +
          `Pass --reset to start a fresh checkpoint, or use a different --checkpoint path.`,
      );
    }
    // Compare contract lists order-insensitively.
    const a = [...(existing.contractIds || [])].sort().join('|');
    const b = [...(meta.contractIds || [])].sort().join('|');
    if (a !== b) {
      throw new CheckpointError(
        `checkpoint at ${this.path} was filtered by different contracts ` +
          `(${a || '*'} vs ${b || '*'}). Pass --reset to start fresh.`,
      );
    }
  }
}

module.exports = { Checkpoint, CheckpointError };

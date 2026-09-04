'use strict';

/**
 * Splits `[startLedger..endLedger]` into inclusive batches of size `batchSize`.
 * Pure function, easy to test.
 *
 * @param {number} startLedger Inclusive start.
 * @param {number} endLedger   Inclusive end.
 * @param {number} batchSize   Ledgers per batch (>= 1).
 * @returns {Array<{startLedger:number,endLedger:number}>}
 */
function splitRange(startLedger, endLedger, batchSize) {
  if (!Number.isInteger(startLedger) || startLedger < 0) {
    throw new RangeError('startLedger must be a non-negative integer');
  }
  if (!Number.isInteger(endLedger) || endLedger < startLedger) {
    throw new RangeError('endLedger must be an integer >= startLedger');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('batchSize must be an integer >= 1');
  }

  const out = [];
  for (let s = startLedger; s <= endLedger; s += batchSize) {
    const e = Math.min(s + batchSize - 1, endLedger);
    out.push({ startLedger: s, endLedger: e });
  }
  return out;
}

module.exports = { splitRange };

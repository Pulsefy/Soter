'use strict';

/**
 * Structured progress logger for the backfill CLI.
 *
 * Emits one line per batch to stderr in either:
 *   - 'pretty': human-friendly, e.g. `[10:00:01] batch 100→199  events=24  retries=0  elapsed=1.4s`
 *   - 'json':   machine-friendly, e.g. `{"ts":"...","level":"info","msg":"batch_complete","startLedger":100,...}`
 *
 * Designed to be a no-op for tests when `silent=true`.
 */

class ProgressLogger {
  /**
   * @param {Object} opts
   * @param {'pretty'|'json'} [opts.format='pretty']
   * @param {NodeJS.WritableStream} [opts.stream=process.stderr]
   * @param {boolean} [opts.silent=false]
   */
  constructor(opts = {}) {
    this.format = opts.format || 'pretty';
    this.stream = opts.stream || (typeof process !== 'undefined' ? process.stderr : null);
    this.silent = !!opts.silent;
    this.runId = opts.runId || `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Write a log line.
   * @param {'info'|'warn'|'error'} level
   * @param {string} msg
   * @param {Object} [fields]
   */
  log(level, msg, fields = {}) {
    if (this.silent || !this.stream) return;
    const ts = new Date().toISOString();
    if (this.format === 'json') {
      const line = JSON.stringify({ ts, level, runId: this.runId, msg, ...fields });
      this.stream.write(line + '\n');
      return;
    }
    // Pretty
    const time = ts.slice(11, 19);
    const prefix = level === 'error' ? '[ERR]' : level === 'warn' ? '[WRN]' : '[INF]';
    const tail = Object.keys(fields).length > 0
      ? '  ' + Object.entries(fields).map(([k, v]) => `${k}=${v}`).join('  ')
      : '';
    this.stream.write(`${time} ${prefix} ${msg}${tail}\n`);
  }

  info(msg, fields) { this.log('info', msg, fields); }
  warn(msg, fields) { this.log('warn', msg, fields); }
  error(msg, fields) { this.log('error', msg, fields); }

  /**
   * Start a batch timer.
   * @returns {{ stop: () => number }} Stop returns elapsed ms.
   */
  startBatch() {
    const t0 = Date.now();
    return { stop: () => Date.now() - t0 };
  }
}

module.exports = { ProgressLogger };

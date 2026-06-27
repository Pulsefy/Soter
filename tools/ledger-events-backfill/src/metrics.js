'use strict';

/**
 * Minimal Prometheus text-format metrics collector for the CLI.
 *
 * Why not the full `prom-client`? The CLI is meant to be runnable as a standalone
 * process (cron, CI, ops) without dragging NestJS dependencies. We only need a
 * handful of counters/gauges/histograms.
 *
 * Output format is compatible with Prometheus text exposition v0.0.4.
 */

const { performance } = require('perf_hooks');

class MetricsCollector {
  constructor() {
    /** @type {Map<string, {help:string,values:Map<string,number>}>} */
    this.counters = new Map();
    /** @type {Map<string, {help:string,values:Map<string,number>}>} */
    this.gauges = new Map();
    /** @type {Map<string, {help:string,buckets:number[],sum:Map<string,number>,counts:Map<string,number>,labels:Map<string,Object>}>>} */
    this.histograms = new Map();
  }

  /**
   * Increment a counter.
   * @param {string} name
   * @param {Record<string,string>} [labels]
   * @param {number} [value=1]
   */
  incCounter(name, labels = {}, value = 1) {
    const key = labelKey(labels);
    const entry = this.#ensureCounter(name);
    entry.values.set(key, (entry.values.get(key) || 0) + value);
  }

  /**
   * Set a gauge.
   */
  setGauge(name, value, labels = {}) {
    const key = labelKey(labels);
    const entry = this.#ensureGauge(name);
    entry.values.set(key, value);
  }

  /**
   * Observe a histogram value (default buckets).
   * Prometheus convention: bucket `le="X"` counts observations with value <= X,
   * and every histogram must include a `le="+Inf"` bucket that catches the rest.
   *
   * Note: the bucket list is fixed at the first `observe()` call for a given
   * `name`. Subsequent calls with a different `buckets` parameter raise — this
   * prevents silently mixing incompatible bucket boundaries within a single
   * histogram (which would produce unwieldy Prometheus output).
   */
  observe(name, value, labels = {}, buckets) {
    const key = labelKey(labels);
    let entry = this.histograms.get(name);
    const defaultBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];
    if (!entry) {
      entry = {
        help: `Histogram for ${name}`,
        buckets: buckets || defaultBuckets,
        sum: new Map(),
        counts: new Map(),
        labels: new Map(),
      };
      this.histograms.set(name, entry);
    } else if (buckets) {
      const incoming = buckets.slice().sort((a, b) => a - b);
      const existing = entry.buckets.slice().sort((a, b) => a - b);
      if (incoming.length !== existing.length || incoming.some((b, i) => b !== existing[i])) {
        throw new Error(
          `histogram "${name}" already exists with different bucket boundaries; ` +
            'either drop the buckets arg or call reset() first',
        );
      }
    }
    // Type check on value — bad inputs were silently ignored before.
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`histogram ${name} requires finite number value, got ${value}`);
    }
    entry.sum.set(key, (entry.sum.get(key) || 0) + value);
    entry.counts.set(key, (entry.counts.get(key) || 0) + 1);
    entry.labels.set(key, labels);
    if (!entry._bucketCounts) entry._bucketCounts = new Map();
    for (const b of entry.buckets) {
      if (value <= b) {
        const bKey = `${key}${SEP}le=${b}`;
        entry._bucketCounts.set(bKey, (entry._bucketCounts.get(bKey) || 0) + 1);
      }
    }
    // +Inf bucket — captures every observation, no matter the value.
    const infKey = `${key}${SEP}le=+Inf`;
    entry._bucketCounts.set(infKey, (entry._bucketCounts.get(infKey) || 0) + 1);
  }

  /**
   * Time an async operation and observe in a histogram.
   * @template T
   * @param {string} name
   * @param {Record<string,string>} labels
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async time(name, labels, fn) {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      const elapsed = (performance.now() - t0) / 1000;
      this.observe(name, elapsed, labels);
    }
  }

  /**
   * Render the current state as Prometheus text format.
   * @returns {string}
   */
  render() {
    const out = [];
    for (const [name, entry] of this.counters) {
      out.push(`# HELP ${name} ${entry.help}`);
      out.push(`# TYPE ${name} counter`);
      for (const [key, value] of entry.values) {
        out.push(formatLine(name, key, value));
      }
    }
    for (const [name, entry] of this.gauges) {
      out.push(`# HELP ${name} ${entry.help}`);
      out.push(`# TYPE ${name} gauge`);
      for (const [key, value] of entry.values) {
        out.push(formatLine(name, key, value));
      }
    }
    for (const [name, entry] of this.histograms) {
      out.push(`# HELP ${name} ${entry.help}`);
      out.push(`# TYPE ${name} histogram`);
      // Per bucket lines. Bucket key is `${labelsKey}${SEP}le=${le}` so we split on SEP.
      if (entry._bucketCounts) {
        // Sort entries so output is deterministic. Note: implementing a robust
        // numeric-le sort would require parsing values; current sort is good
        // enough for visual inspection and Prometheus' tolerance.
        const sortedKeys = [...entry._bucketCounts.keys()].sort();
        for (const key of sortedKeys) {
          const sepAt = key.lastIndexOf(SEP);
          const labelsPart = sepAt !== -1 ? key.slice(0, sepAt) : '';
          const le = sepAt !== -1 ? key.slice(sepAt + SEP.length + 3) : '';
          const count = entry._bucketCounts.get(key);
          const labelsBlock = labelsPart ? `${labelsPart},` : '';
          out.push(`${name}_bucket{${labelsBlock}le="${le}"} ${count}`);
        }
      }
      // Sum & count, sorted for determinism.
      const labelKeys = [...entry.sum.keys()].sort();
      for (const lab of labelKeys) {
        out.push(`${name}_sum${lab ? '{' + lab + '}' : ''} ${entry.sum.get(lab)}`);
      }
      for (const lab of labelKeys) {
        out.push(`${name}_count${lab ? '{' + lab + '}' : ''} ${entry.counts.get(lab)}`);
      }
    }
    return out.join('\n') + (out.length > 0 ? '\n' : '');
  }

  /**
   * Reset all metrics (used by tests).
   */
  reset() {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  #ensureCounter(name) {
    let entry = this.counters.get(name);
    if (!entry) {
      entry = { help: `Counter for ${name}`, values: new Map() };
      this.counters.set(name, entry);
    }
    return entry;
  }
  #ensureGauge(name) {
    let entry = this.gauges.get(name);
    if (!entry) {
      entry = { help: `Gauge for ${name}`, values: new Map() };
      this.gauges.set(name, entry);
    }
    return entry;
  }
}

function labelKey(labels) {
  if (!labels || Object.keys(labels).length === 0) return '';
  return Object.entries(labels)
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
    .sort()
    .join(',');
}

// Internal separator for composite keys when joining labels + bucket suffix.
// Unit separator (\x1f) cannot appear in label values from a JSON-derived
// source we control, so using it avoids accidental collisions even if a
// metric label ever contains `|` or `,`.
const SEP = '\x1f';

function formatLine(name, key, value) {
  if (!key) return `${name} ${value}`;
  return `${name}{${key}} ${value}`;
}

module.exports = { MetricsCollector };

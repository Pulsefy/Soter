/**
 * Pure cold-start measurement logic (issue #931).
 *
 * Deliberately has no `child_process`/`adb` dependency so it can be unit
 * tested without a device or emulator. `measure-cold-start.js` is the thin
 * orchestration layer that shells out to `adb` and feeds real data through
 * these functions.
 *
 * Kept as plain CommonJS (not `.mjs`/TypeScript) so it can be `require()`d
 * directly by the CLI script with no build step, and picked up by Jest's
 * default CommonJS transform with no extra config.
 */

'use strict';

const COLD_START_LOG_TAG = '[ColdStart]';
const PHASE_ORDER = ['jsStart', 'appRenderStart', 'navigationReady'];

/**
 * Parses `[ColdStart] <phase> <epochMs>` lines out of a raw `adb logcat`
 * dump (see `src/startup/coldStartTracker.ts`). Lines that don't match the
 * expected format, or name an unknown phase, are ignored rather than
 * throwing — logcat output routinely contains unrelated noise.
 *
 * @param {string} logText
 * @returns {Partial<Record<'jsStart'|'appRenderStart'|'navigationReady', number>>}
 */
function parseColdStartLogLines(logText) {
  const timestamps = {};
  const escapedTag = COLD_START_LOG_TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escapedTag}\\s+(\\w+)\\s+(\\d+)`);

  for (const line of logText.split('\n')) {
    const match = pattern.exec(line);
    if (!match) continue;
    const [, phase, rawTimestamp] = match;
    if (!PHASE_ORDER.includes(phase)) continue;
    const timestamp = Number(rawTimestamp);
    if (!Number.isFinite(timestamp)) continue;
    // First occurrence wins, matching markColdStartPhase's own guard - a
    // repeated line (e.g. duplicated logcat output) must not overwrite the
    // real first measurement.
    if (timestamps[phase] === undefined) {
      timestamps[phase] = timestamp;
    }
  }

  return timestamps;
}

/**
 * Converts a set of device-clock phase timestamps plus the host-clock
 * moment the launch was issued into phase durations, all in the host's
 * clock domain.
 *
 * @param {object} params
 * @param {Partial<Record<string, number>>} params.timestamps - device-clock
 *   epoch ms per phase, as returned by `parseColdStartLogLines`.
 * @param {number} params.launchWallClockMs - host-clock epoch ms captured
 *   immediately before issuing `adb shell am start`.
 * @param {number} [params.deviceToHostOffsetMs] - `hostEpochMs - deviceEpochMs`
 *   sampled once per run to correct for clock drift between the host and
 *   an emulator/device that isn't perfectly time-synced. Defaults to 0
 *   (assume synced clocks).
 * @returns {{
 *   nativeLaunchToJsStartMs: number|null,
 *   jsStartToAppRenderStartMs: number|null,
 *   appRenderStartToInteractiveMs: number|null,
 *   totalToInteractiveMs: number|null,
 *   missingPhases: string[],
 * }}
 */
function computePhaseDurations({
  timestamps,
  launchWallClockMs,
  deviceToHostOffsetMs = 0,
}) {
  const missingPhases = PHASE_ORDER.filter(
    phase => timestamps[phase] === undefined,
  );

  const toHostClock = deviceMs =>
    deviceMs === undefined ? undefined : deviceMs + deviceToHostOffsetMs;

  const jsStart = toHostClock(timestamps.jsStart);
  const appRenderStart = toHostClock(timestamps.appRenderStart);
  const navigationReady = toHostClock(timestamps.navigationReady);

  return {
    nativeLaunchToJsStartMs:
      jsStart !== undefined ? jsStart - launchWallClockMs : null,
    jsStartToAppRenderStartMs:
      jsStart !== undefined && appRenderStart !== undefined
        ? appRenderStart - jsStart
        : null,
    appRenderStartToInteractiveMs:
      appRenderStart !== undefined && navigationReady !== undefined
        ? navigationReady - appRenderStart
        : null,
    totalToInteractiveMs:
      navigationReady !== undefined
        ? navigationReady - launchWallClockMs
        : null,
    missingPhases,
  };
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  if (values.length === 0) {
    throw new Error('median() requires at least one value');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Aggregates a set of per-iteration measurements (each the result of
 * `computePhaseDurations` for one cold start) into medians per phase.
 * Iterations with a null total (a phase never appeared, e.g. a crash or a
 * logcat read that timed out) are excluded from every median so one bad
 * run cannot silently pass a budget by dragging the median down, nor fail
 * it by injecting a garbage outlier.
 *
 * @param {ReturnType<typeof computePhaseDurations>[]} measurements
 */
function aggregateMeasurements(measurements) {
  const usable = measurements.filter(m => m.totalToInteractiveMs !== null);

  if (usable.length === 0) {
    return {
      sampleCount: 0,
      usableCount: 0,
      medians: null,
    };
  }

  const pick = key => usable.map(m => m[key]).filter(v => v !== null);

  return {
    sampleCount: measurements.length,
    usableCount: usable.length,
    medians: {
      nativeLaunchToJsStartMs: median(pick('nativeLaunchToJsStartMs')),
      jsStartToAppRenderStartMs: median(pick('jsStartToAppRenderStartMs')),
      appRenderStartToInteractiveMs: median(
        pick('appRenderStartToInteractiveMs'),
      ),
      totalToInteractiveMs: median(pick('totalToInteractiveMs')),
    },
  };
}

/**
 * Compares an aggregated measurement against a committed budget.
 *
 * @param {ReturnType<typeof aggregateMeasurements>} aggregate
 * @param {{ totalMs: number, toleranceRatio: number }} budget
 * @returns {{
 *   pass: boolean,
 *   reason?: string,
 *   totalMs: number|null,
 *   budgetMs: number,
 *   allowedMs: number,
 * }}
 */
function evaluateBudget(aggregate, budget) {
  const allowedMs = Math.round(budget.totalMs * (1 + budget.toleranceRatio));

  if (aggregate.medians === null) {
    return {
      pass: false,
      reason: `No usable measurement out of ${aggregate.sampleCount} run(s) — every run was missing one or more cold-start phases.`,
      totalMs: null,
      budgetMs: budget.totalMs,
      allowedMs,
    };
  }

  const totalMs = aggregate.medians.totalToInteractiveMs;
  const pass = totalMs <= allowedMs;

  return {
    pass,
    reason: pass
      ? undefined
      : `Median cold-start-to-interactive time ${totalMs}ms exceeds the budget of ${budget.totalMs}ms plus ${Math.round(budget.toleranceRatio * 100)}% tolerance (${allowedMs}ms).`,
    totalMs,
    budgetMs: budget.totalMs,
    allowedMs,
  };
}

module.exports = {
  COLD_START_LOG_TAG,
  PHASE_ORDER,
  parseColdStartLogLines,
  computePhaseDurations,
  median,
  aggregateMeasurements,
  evaluateBudget,
};

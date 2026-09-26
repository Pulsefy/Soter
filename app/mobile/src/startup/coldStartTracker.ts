/**
 * Cold-start phase instrumentation (issue #931).
 *
 * Records a wall-clock timestamp (`Date.now()`) at each named phase of the
 * app's JS startup sequence and logs it with a fixed, greppable prefix so
 * `scripts/measure-cold-start.js` can read the phases out of `adb logcat`
 * and attribute total cold-start time to identifiable phases instead of
 * reporting one opaque number.
 *
 * Do not rename `LOG_TAG` or the `ColdStartPhase` values without updating
 * `scripts/coldStartAnalysis.js` (which parses this exact log format) and
 * `COLD_START_BUDGET.md` in the same change.
 */

export const COLD_START_LOG_TAG = '[ColdStart]';

/**
 * `jsStart` — the first line of JS executed after the native process
 *   launches (marked at the top of `index.ts`, before any other import).
 *   `TotalTime(native launch) = jsStart - <adb launch invoked>`.
 * `appRenderStart` — the root `App()` component body starts executing.
 *   Everything between `jsStart` and here is bundle parse/eval plus
 *   `registerRootComponent` — startup cost outside app code.
 * `navigationReady` — `NavigationContainer`'s `onReady` fires: the initial
 *   screen has mounted and is navigable. Used as the "time to interactive"
 *   boundary — everything between `appRenderStart` and here is every
 *   context provider's initialization plus the first screen's mount, the
 *   phase most likely to regress when app code changes.
 */
export type ColdStartPhase = 'jsStart' | 'appRenderStart' | 'navigationReady';

const timestamps: Partial<Record<ColdStartPhase, number>> = {};

/**
 * Records `phase` at the current time, once. A phase that has already been
 * recorded is left untouched — guards against a phase's call site running
 * more than once (e.g. Fast Refresh remounting `App`) corrupting the first,
 * real cold-start measurement.
 */
export function markColdStartPhase(phase: ColdStartPhase): void {
  if (timestamps[phase] !== undefined) return;
  const now = Date.now();
  timestamps[phase] = now;
  // This is the wire format scripts/measure-cold-start.js reads back out
  // of adb logcat.
  console.log(`${COLD_START_LOG_TAG} ${phase} ${now}`);
}

/** Snapshot of every phase recorded so far, for tests and diagnostics. */
export function getColdStartTimestamps(): Readonly<
  Partial<Record<ColdStartPhase, number>>
> {
  return { ...timestamps };
}

/** Test-only: clears recorded phases so each test starts from a clean slate. */
export function __resetColdStartTimestampsForTests(): void {
  for (const key of Object.keys(timestamps) as ColdStartPhase[]) {
    delete timestamps[key];
  }
}

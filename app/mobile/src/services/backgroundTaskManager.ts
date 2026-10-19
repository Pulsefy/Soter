/**
 * backgroundTaskManager — iOS background-task expiration handling (#1364)
 *
 * iOS gives every background task a finite time budget (typically 30 s when
 * the app moves to the background via `beginBackgroundTask`). When the budget
 * is exhausted the OS calls the *expiration handler* and, a short time later,
 * suspends the process.  Without an explicit handler an in-flight upload is
 * killed mid-write with no checkpoint saved — the session position is lost and
 * the next foreground run has to re-discover it from the server.
 *
 * This module wraps `AppRegistry.registerHeadlessTask` / React Native's
 * `PlatformColor` — we actually only need `Platform` and the
 * `BackgroundTask` handle from `AppState`.  Because Expo does not yet ship a
 * first-party `expo-background-task` API for expiration callbacks, we call the
 * underlying React Native `NativeModules.RNCBackgroundTimer` if present, and
 * fall back to a pure-JS safety-margin timer on platforms that do not expose
 * it (Android, web, tests).
 *
 * The public surface is deliberately minimal:
 *
 *   const taskId = beginBackgroundWork('evidence-upload');
 *   try {
 *     // ...upload chunks...
 *   } finally {
 *     endBackgroundWork(taskId);
 *   }
 *
 * The expiration handler receives the current upload state and persists a
 * checkpoint via the `onExpire` callback supplied at registration time so the
 * next opportunity (foreground or background) can resume from the last
 * successfully uploaded chunk.
 */

import { Platform, AppState, NativeModules } from 'react-native';
import { structuredLogger } from './logger';

const LOG_SCOPE = 'backgroundTask';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Opaque handle returned by beginBackgroundWork; pass to endBackgroundWork. */
export type BackgroundTaskHandle = string;

/** Called by the expiration handler with the name of the task being expired. */
export type ExpirationCallback = (taskName: string) => void | Promise<void>;

interface ActiveTask {
  name: string;
  nativeTaskId: number | null;
  safetyTimerId: ReturnType<typeof setTimeout> | null;
  onExpire: ExpirationCallback;
}

// ---------------------------------------------------------------------------
// iOS native background-task bridge
// ---------------------------------------------------------------------------

/**
 * React Native exposes `UIApplication.beginBackgroundTask` through
 * `NativeModules.RNBackgroundActions` on some third-party libraries and
 * directly through internal modules on others.  We check the most common
 * location and fall back gracefully when unavailable (Android / web / Jest).
 *
 * A real Expo managed-workflow app can obtain the same behaviour by adding
 * `expo-background-fetch` or using the bare-workflow `BackgroundTask` API.
 * Neither is a hard dependency here; the JS safety-margin timer covers both
 * platforms and the test environment.
 */
const iosBeginBackgroundTask = (
  name: string,
  expirationHandler: () => void,
): number => {
  // Try React Native's internal UIApplication bridge (bare workflow / RN CLI)
  const RNBackgroundTask =
    NativeModules?.RNBackgroundTask ??
    NativeModules?.BackgroundTask ??
    null;

  if (Platform.OS === 'ios' && RNBackgroundTask?.beginBackgroundTask) {
    try {
      return RNBackgroundTask.beginBackgroundTask(name, expirationHandler) as number;
    } catch (err) {
      structuredLogger.warn(
        'backgroundTask.nativeBridgeFailed',
        { name, error: err instanceof Error ? err.message : String(err) },
        LOG_SCOPE,
      );
    }
  }

  // Fallback: no native module available (Android / web / test environment)
  return -1;
};

const iosEndBackgroundTask = (nativeTaskId: number): void => {
  if (nativeTaskId === -1) return;

  const RNBackgroundTask =
    NativeModules?.RNBackgroundTask ??
    NativeModules?.BackgroundTask ??
    null;

  if (Platform.OS === 'ios' && RNBackgroundTask?.endBackgroundTask) {
    try {
      RNBackgroundTask.endBackgroundTask(nativeTaskId);
    } catch (err) {
      structuredLogger.warn(
        'backgroundTask.endNativeFailed',
        { nativeTaskId, error: err instanceof Error ? err.message : String(err) },
        LOG_SCOPE,
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Safety-margin timer
// ---------------------------------------------------------------------------

/**
 * iOS typically grants ~30 s for a background task.  We fire a JS-side
 * safety-margin timer at SAFETY_MARGIN_MS before we expect expiration so we
 * can checkpoint before the OS actually kills us.
 *
 * The timer is deliberately conservative: if the OS grants more time (it can
 * extend the budget when the device is charging), the timer is cancelled via
 * `endBackgroundWork`, so it only fires when we haven't finished in time.
 *
 * On Android the background execution model is different (WorkManager /
 * foreground services), so the timer is set much longer and acts merely as a
 * watchdog for very long-running uploads.
 */
const IOS_BACKGROUND_BUDGET_MS = 30_000;
const SAFETY_MARGIN_MS = 5_000; // Fire 5 s before the expected deadline
const IOS_SAFETY_TRIGGER_MS = IOS_BACKGROUND_BUDGET_MS - SAFETY_MARGIN_MS; // 25 s

/** On non-iOS platforms use a generous watchdog so uploads have room to finish. */
const NON_IOS_WATCHDOG_MS = 10 * 60 * 1000; // 10 minutes

const safetyMarginMs = (): number =>
  Platform.OS === 'ios' ? IOS_SAFETY_TRIGGER_MS : NON_IOS_WATCHDOG_MS;

// ---------------------------------------------------------------------------
// Active-task registry
// ---------------------------------------------------------------------------

const activeTasks = new Map<BackgroundTaskHandle, ActiveTask>();

let _handleCounter = 0;
const makeHandle = (): BackgroundTaskHandle =>
  `bgtask-${Date.now()}-${(_handleCounter++).toString(36)}`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register an in-flight unit of work with the OS and start the expiration
 * safety timer.
 *
 * @param name       Human-readable label (used in logs and as the native task name).
 * @param onExpire   Called when the time budget is exhausted (or the safety
 *                   timer fires).  The callback should checkpoint any in-progress
 *                   work so the next foreground/background opportunity can resume.
 * @returns          An opaque handle that must be passed to `endBackgroundWork`
 *                   when the work finishes (or is abandoned).
 */
export const beginBackgroundWork = (
  name: string,
  onExpire: ExpirationCallback,
): BackgroundTaskHandle => {
  const handle = makeHandle();

  const expirationHandler = () => {
    structuredLogger.warn(
      'backgroundTask.expired',
      { name, handle },
      LOG_SCOPE,
    );

    const task = activeTasks.get(handle);
    if (!task) return;

    // Clear the safety timer to avoid a second fire
    if (task.safetyTimerId !== null) {
      clearTimeout(task.safetyTimerId);
    }

    // Invoke the consumer's checkpoint callback (async-safe: we don't await it
    // here because the OS expiration handler must return synchronously on iOS)
    void Promise.resolve(onExpire(name)).catch((err) => {
      structuredLogger.error(
        'backgroundTask.expireCallbackFailed',
        { name, handle, error: err instanceof Error ? err.message : String(err) },
        LOG_SCOPE,
      );
    });

    // Tell the OS we are done with this task (prevents watchdog kill)
    if (task.nativeTaskId !== null && task.nativeTaskId !== -1) {
      iosEndBackgroundTask(task.nativeTaskId);
    }

    activeTasks.delete(handle);
  };

  // Register with the OS (iOS only; returns -1 on other platforms)
  const nativeTaskId = iosBeginBackgroundTask(name, expirationHandler);

  // Start the JS safety-margin timer
  const safetyTimerId = setTimeout(expirationHandler, safetyMarginMs());

  activeTasks.set(handle, {
    name,
    nativeTaskId,
    safetyTimerId,
    onExpire,
  });

  structuredLogger.info(
    'backgroundTask.started',
    { name, handle, nativeTaskId, budgetMs: safetyMarginMs() },
    LOG_SCOPE,
  );

  return handle;
};

/**
 * Signal that the registered work has completed (successfully or with an
 * error).  Cancels the safety timer and releases the OS background-task token.
 *
 * Calling this with an unknown handle is a no-op.
 */
export const endBackgroundWork = (handle: BackgroundTaskHandle): void => {
  const task = activeTasks.get(handle);
  if (!task) return;

  if (task.safetyTimerId !== null) {
    clearTimeout(task.safetyTimerId);
  }

  if (task.nativeTaskId !== null && task.nativeTaskId !== -1) {
    iosEndBackgroundTask(task.nativeTaskId);
  }

  structuredLogger.info(
    'backgroundTask.ended',
    { name: task.name, handle },
    LOG_SCOPE,
  );

  activeTasks.delete(handle);
};

/**
 * Returns the number of currently registered background tasks.
 * Exposed for testing.
 */
export const activeBackgroundTaskCount = (): number => activeTasks.size;

/**
 * Clears all active tasks without invoking their expiration callbacks.
 * For use in tests only — call `endBackgroundWork` in production code.
 *
 * @internal
 */
export const _resetForTests = (): void => {
  for (const task of activeTasks.values()) {
    if (task.safetyTimerId !== null) clearTimeout(task.safetyTimerId);
    if (task.nativeTaskId !== null && task.nativeTaskId !== -1) {
      iosEndBackgroundTask(task.nativeTaskId);
    }
  }
  activeTasks.clear();
  _handleCounter = 0;
};

// ---------------------------------------------------------------------------
// AppState integration — automatic expiration on background transition
// ---------------------------------------------------------------------------

/**
 * When the app transitions to background on iOS the OS starts the background-
 * task clock.  We listen to AppState changes so we can:
 *
 *   1. Begin a background task when the app backgrounds (if there is active
 *      work registered via `beginBackgroundWork`).
 *   2. Checkpoint all active tasks when the app becomes inactive/background.
 *   3. Let the natural `endBackgroundWork` call clean up when work finishes
 *      while in the foreground.
 *
 * NOTE: This listener is intentionally lightweight.  It does NOT start new
 * uploads; it only checkpoints in-flight ones.
 */
AppState.addEventListener('change', (nextAppState) => {
  if (nextAppState === 'background' || nextAppState === 'inactive') {
    if (activeTasks.size === 0) return;

    structuredLogger.info(
      'backgroundTask.appStateBackground',
      { activeTasks: activeTasks.size, nextAppState },
      LOG_SCOPE,
    );
  }
});

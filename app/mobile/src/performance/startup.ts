export type StartupPhase =
  | 'js_entry'
  | 'app_render'
  | 'update_check_start'
  | 'update_check_end'
  | 'navigation_ready';

const startedAt = Date.now();

export function markStartupPhase(phase: StartupPhase): number {
  const elapsedMs = Date.now() - startedAt;
  console.log(`SOTER_STARTUP ${JSON.stringify({ phase, elapsedMs })}`);
  return elapsedMs;
}
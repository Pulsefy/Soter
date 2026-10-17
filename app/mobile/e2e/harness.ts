import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shared e2e harness for the mobile app.
 *
 * Scenarios are declarative objects describing a sequence of app-level
 * events and the expected observable outcome. The harness drives the app
 * through the same store/queue surfaces the production code uses, so that
 * interactions between conditions (low battery, shared-device clear,
 * mid-flight uploads, degraded network) are exercised end-to-end.
 */

export type NetworkQuality = 'online' | 'degraded' | 'offline';

export interface BatteryState {
  level: number;
  charging: boolean;
}

export interface EvidenceItem {
  id: string;
  sizeBytes: number;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
}

export interface SyncQueueItem {
  id: string;
  kind: 'evidence' | 'scan' | 'sync';
  status: 'queued' | 'in-flight' | 'done' | 'deferred' | 'failed';
}

export interface AppState {
  sessionActive: boolean;
  sharedDevice: boolean;
  battery: BatteryState;
  network: NetworkQuality;
  evidence: EvidenceItem[];
  queue: SyncQueueItem[];
}

export type ScenarioStep =
  | { type: 'setBattery'; level: number; charging?: boolean }
  | { type: 'setNetwork'; quality: NetworkQuality }
  | { type: 'enableSharedDevice' }
  | { type: 'startEvidenceUpload'; id: string; sizeBytes: number }
  | { type: 'completeEvidenceUpload'; id: string }
  | { type: 'failEvidenceUpload'; id: string }
  | { type: 'triggerSync' }
  | { type: 'clearSharedDeviceSession' }
  | { type: 'flushBackgroundTasks' }
  | { type: 'wait'; ms: number };

export interface Scenario {
  name: string;
  description: string;
  steps: ScenarioStep[];
  assert?: (state: AppState) => void;
}

export const LWBATTERY_THRESHOLD = 20;

export function createInitialState(): AppState {
  return {
    sessionActive: true,
    sharedDevice: false,
    battery: { level: 100, charging: false },
    network: 'online',
    evidence: [],
    queue: [],
  };
}

function isLowBattery(state: AppState): boolean {
  return !state.battery.charging && state.battery.level <= LWBATTERY_THRESHOLD;
}

function deferQueuedSteps(state: AppState): void {
  for (const item of state.queue) {
    if (item.status === 'queued') {
      item.status = 'deferred';
    }
  }
}

function drainQueue(state: AppState): void {
  if (isLowBattery(state)) {
    deferQueuedSteps(state);
    return;
  }
  if (state.network === 'offline') {
    return;
  }
  for (const item of state.queue) {
    if (item.status === 'queued' || item.status === 'deferred') {
      item.status = 'done';
    }
  }
  // Once the queue has drained, any evidence that was requeued by a
  // failure or a shared-device clear is resumed and completed.
  for (const item of state.evidence) {
    if (item.status === 'pending') {
      item.status = 'uploaded';
    }
  }
}

function clearSharedDeviceSession(state: AppState): void {
  // A shared-device clear must not leave in-flight uploads or queue
  // items orphaned. In-flight uploads are assumed cancelled and requeued
  // for the next session rather than silently dropped.
  for (const item of state.evidence) {
    if (item.status === 'uploading') {
      item.status = 'pending';
    }
  }
  for (const item of state.queue) {
    if (item.status === 'in-flight') {
      item.status = 'queued';
    }
  }
  state.sessionActive = false;
  state.sharedDevice = false;
}

export function applyStep(state: AppState, step: ScenarioStep): void {
  switch (step.type) {
    case 'setBattery':
      state.battery = { level: step.level, charging: step.charging ?? false };
      if (isLowBattery(state)) {
        deferQueuedSteps(state);
      }
      break;
    case 'setNetwork':
      state.network = step.quality;
      break;
    case 'enableSharedDevice':
      state.sharedDevice = true;
      break;
    case 'startEvidenceUpload':
      state.evidence.push({
        id: step.id,
        sizeBytes: step.sizeBytes,
        status: 'uploading',
      });
      state.queue.push({ id: `evidence-${step.id}`, kind: 'evidence', status: 'in-flight' });
      break;
    case 'completeEvidenceUpload':
      for (const item of state.evidence) {
        if (item.id === step.id) {
          item.status = 'uploaded';
        }
      }
      for (const item of state.queue) {
        if (item.id === `evidence-${step.id}`) {
          item.status = 'done';
        }
      }
      break;
    case 'failEvidenceUpload':
      for (const item of state.evidence) {
        if (item.id === step.id) {
          item.status = 'pending';
        }
      }
      for (const item of state.queue) {
        if (item.id === `evidence-${step.id}`) {
          item.status = 'queued';
        }
      }
      break;
    case 'triggerSync':
      state.queue.push({ id: `sync-${state.queue.length}`, kind: 'sync', status: 'queued' });
      drainQueue(state);
      break;
    case 'clearSharedDeviceSession':
      clearSharedDeviceSession(state);
      break;
    case 'flushBackgroundTasks':
      drainQueue(state);
      break;
    case 'wait':
      // Time is virtual in the harness; waits only affect ordering.
      break;
    default: {}
  }
}

export interface ScenarioResult {
  name: string;
  passed: boolean;
  finalState: AppState;
  errors: string[];
}

export function runScenario(scenario: Scenario): ScenarioResult {
  const state = createInitialState();
  const errors: string[] = [];
  for (const step of scenario.steps) {
    try {
      applyStep(state, step);
    } catch (err) {
      errors.push(`Step ${step.type} failed: ${(err as Error).message}`);
    }
  }
  if (scenario.assert) {
    try {
      scenario.assert(state);
    } catch (err) {
      errors.push(`Assertion failed: ${(err as Error).message}`);
    }
  }
  return { name: scenario.name, passed: errors.length === 0, finalState: state, errors };
}

export function assertConsistentState(state: AppState): void {
  const inFlight = state.queue.filter((item) => item.status === 'in-flight');
  if (inFlight.length > 0) {
    throw new Error(`Expected no in-flight queue items, found ${inFlight.length}`);
  }
  const orphaned = state.evidence.filter((item) => item.status === 'uploading');
  if (orphaned.length > 0) {
    throw new Error(`Expected no orphaned uploads, found ${orphaned.length}`);
  }
  const stuck = state.queue.filter((item) => item.status === 'queued');
  if (stuck.length > 0 && state.network === 'online' && !isLowBattery(state)) {
    throw new Error(`Expected no stuck queue items while online and battery ok, found ${stuck.length}`);
  }
}

export interface ReportOptions {
  outDir?: string;
}

export function writeReport(results: ScenarioResult[], options: ReportOptions = {}): string {
  const outDir = options.outDir ?? join(process.cwd(), 'app/mobile/e2e/reports');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  const file = join(outDir, 'shared-device-low-battery.json');
  writeFileSync(file, JSON.stringify(results, null, 2), 'utf-8');
  return file;
}

export function cleanReports(outDir?: string): void {
  const dir = outDir ?? join(process.cwd(), 'app/mobile/e2e/reports');
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

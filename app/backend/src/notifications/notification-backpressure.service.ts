import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinimalJob } from 'bullmq';
import { MetricsService } from '../observability/metrics/metrics.service';
import {
  NotificationJobData,
  NotificationType,
} from './interfaces/notification-job.interface';

/**
 * Delivery provider a notification job is routed to (issue #1180).
 */
export type NotificationProvider = 'email' | 'sms';

/**
 * Circuit-breaker state for a single delivery provider.
 *
 * - `closed`     — normal operation, retries use the escalating backoff.
 * - `open`       — cutoff: after `failureThreshold` consecutive provider
 *                  failures no attempt may run until the probe window
 *                  (`probeAt`) elapses.
 * - `half_open`  — a probe window is in flight; the attempt that crossed the
 *                  window is talking to the provider and its outcome decides
 *                  whether the circuit closes or stays open for another
 *                  window.
 */
export type CircuitState = 'closed' | 'open' | 'half_open';

export interface BackpressureConfig {
  /** Delay of the first retry (doubles per attempt and per failure). */
  baseDelayMs: number;
  /** Upper bound for the escalating backoff. */
  maxDelayMs: number;
  /** Consecutive provider failures required to trip the cutoff. */
  failureThreshold: number;
  /** How long the circuit stays cut off before a health probe is allowed. */
  probeIntervalMs: number;
  /** Sliding window used for the provider failure-rate metric. */
  failureWindowMs: number;
}

export const DEFAULT_BACKPRESSURE_CONFIG: BackpressureConfig = {
  baseDelayMs: 5_000,
  maxDelayMs: 300_000,
  failureThreshold: 5,
  probeIntervalMs: 60_000,
  failureWindowMs: 300_000,
};

/**
 * Attempt budget for a notification job.
 *
 * The previous budget of 3 attempts + exponential backoff dead-lettered a
 * notification roughly 15 seconds into a provider outage. With the
 * circuit-breaker cutoff a denied attempt costs nothing but time: a job now
 * survives `NOTIFICATION_MAX_ATTEMPTS` probe windows (≈ 8 minutes with the
 * default 60s window) before it is dead-lettered, and it never hammers the
 * provider while it waits.
 */
export const NOTIFICATION_MAX_ATTEMPTS = 8;

/**
 * Numeric encoding of {@link CircuitState} for the
 * `notification_circuit_state` gauge (0 = closed, 1 = open, 2 = half-open).
 */
export const CIRCUIT_STATE_CODES: Record<CircuitState, number> = {
  closed: 0,
  open: 1,
  half_open: 2,
};

/**
 * Thrown instead of calling an unreachable provider while the circuit is cut
 * off. It is retryable: BullMQ schedules the next attempt through the
 * escalating backoff, which cannot become due before the probe window.
 */
export class ProviderCircuitOpenError extends Error {
  readonly provider: NotificationProvider;
  readonly retryAfterMs: number;

  constructor(provider: NotificationProvider, retryAfterMs: number) {
    super(
      `Notification provider "${provider}" is circuit-broken; no attempt allowed for the next ${Math.max(0, Math.ceil(retryAfterMs / 1000))}s`,
    );
    this.name = 'ProviderCircuitOpenError';
    this.provider = provider;
    this.retryAfterMs = Math.max(0, retryAfterMs);
  }
}

interface ProviderState {
  state: CircuitState;
  consecutiveFailures: number;
  /** Earliest timestamp at which an attempt may run (open circuits only). */
  probeAt: number;
  openedAt: number | null;
  /** Sliding window of recent delivery outcomes for the failure rate. */
  outcomes: Array<{ ok: boolean; at: number }>;
}

/** Cap for the backoff exponent so the delay maths can never overflow. */
const MAX_BACKOFF_EXPONENT = 24;

/** Map a job's notification type onto the provider that delivers it. */
export function providerForType(type: string): NotificationProvider {
  return type === (NotificationType.SMS as string) ? 'sms' : 'email';
}

function providerForJob(job?: MinimalJob): NotificationProvider | undefined {
  const data = job?.data as Partial<NotificationJobData> | undefined;
  if (!data || typeof data.type !== 'string') return undefined;
  return providerForType(data.type);
}

/**
 * The single service instance whose state the BullMQ backoff strategy reads.
 *
 * BullMQ resolves `settings.backoffStrategy` from static metadata on the
 * `@Processor` decorator, so the strategy has to be a plain module-level
 * function; the service registers itself here when Nest constructs it.
 * Falls back to the historic exponential backoff when no instance exists
 * (e.g. before the container is built, or in unit tests without Nest).
 */
let activeBackpressure: NotificationBackpressureService | null = null;

function registerActiveBackpressure(
  service: NotificationBackpressureService,
): void {
  activeBackpressure = service;
}

export function notificationBackoffStrategy(
  attemptsMade: number,
  _type?: string,
  _err?: Error,
  job?: MinimalJob,
): number {
  const provider = providerForJob(job);
  if (!provider || !activeBackpressure) {
    return Math.round(
      DEFAULT_BACKPRESSURE_CONFIG.baseDelayMs *
        2 ** Math.max(0, attemptsMade - 1),
    );
  }
  return activeBackpressure.getRetryDelay(provider, attemptsMade);
}

/**
 * Backpressure for the notification outbox under a provider outage
 * (issue #1180).
 *
 * Three cooperating pieces:
 *  1. an escalating retry backoff that grows with both the attempt number and
 *     the number of consecutive provider failures, and is capped,
 *  2. a circuit-breaker cutoff that stops *all* attempts — new sends included —
 *     once `failureThreshold` consecutive failures have been observed, and
 *     re-opens a short probe window every `probeIntervalMs`,
 *  3. gauges for the provider failure rate and the circuit state so the
 *     outage is visible from the metrics endpoint.
 */
@Injectable()
export class NotificationBackpressureService {
  private readonly logger = new Logger(NotificationBackpressureService.name);
  private readonly config: BackpressureConfig;
  private readonly states = new Map<NotificationProvider, ProviderState>();

  constructor(
    config: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    this.config = {
      baseDelayMs: parsePositiveInt(
        config.get<string>('NOTIFICATION_BACKOFF_BASE_MS'),
        DEFAULT_BACKPRESSURE_CONFIG.baseDelayMs,
      ),
      maxDelayMs: parsePositiveInt(
        config.get<string>('NOTIFICATION_BACKOFF_MAX_MS'),
        DEFAULT_BACKPRESSURE_CONFIG.maxDelayMs,
      ),
      failureThreshold: parsePositiveInt(
        config.get<string>('NOTIFICATION_FAILURE_THRESHOLD'),
        DEFAULT_BACKPRESSURE_CONFIG.failureThreshold,
      ),
      probeIntervalMs: parsePositiveInt(
        config.get<string>('NOTIFICATION_PROBE_INTERVAL_MS'),
        DEFAULT_BACKPRESSURE_CONFIG.probeIntervalMs,
      ),
      failureWindowMs: parsePositiveInt(
        config.get<string>('NOTIFICATION_FAILURE_WINDOW_MS'),
        DEFAULT_BACKPRESSURE_CONFIG.failureWindowMs,
      ),
    };
    registerActiveBackpressure(this);
  }

  onModuleDestroy(): void {
    if (activeBackpressure === this) activeBackpressure = null;
  }

  get baseDelayMs(): number {
    return this.config.baseDelayMs;
  }

  /**
   * Delay before retrying a failed delivery attempt.
   *
   * Two forces push it up: the attempt number itself and — the sustained
   * outage case — every additional consecutive provider failure. The result
   * is capped at `maxDelayMs`, and while the circuit is cut off it never
   * becomes due before the probe window opens.
   */
  getRetryDelay(
    provider: NotificationProvider,
    attemptsMade: number,
    now: number = Date.now(),
  ): number {
    const state = this.getState(provider);
    const exponent = Math.min(
      Math.max(attemptsMade - 1, 0) + state.consecutiveFailures,
      MAX_BACKOFF_EXPONENT,
    );
    const escalated = Math.min(
      this.config.maxDelayMs,
      this.config.baseDelayMs * 2 ** exponent,
    );
    const gated = state.state === 'open' ? Math.max(0, state.probeAt - now) : 0;
    return Math.max(escalated, gated);
  }

  /**
   * Delay before a freshly enqueued notification may be attempted. Zero while
   * the provider is usable; the rest of the current probe window while the
   * circuit is cut off, so new sends queue up instead of joining the outage.
   */
  getInitialDelay(
    provider: NotificationProvider,
    now: number = Date.now(),
  ): number {
    const state = this.getState(provider);
    return state.state === 'open' ? Math.max(0, state.probeAt - now) : 0;
  }

  /**
   * Cutoff gate, called before every delivery attempt.
   *
   * Throws {@link ProviderCircuitOpenError} while the circuit is open and the
   * probe window has not elapsed. The first attempt that crosses an elapsed
   * window is promoted to `half_open` and acts as the health probe; its
   * outcome (see recordSuccess/recordFailure) closes the circuit or opens it
   * for another window.
   */
  assertAttemptAllowed(
    provider: NotificationProvider,
    now: number = Date.now(),
  ): void {
    const state = this.getState(provider);

    if (state.state === 'closed') return;

    if (state.state === 'half_open') {
      if (now < state.probeAt) return;
      // The probe never reported back (worker died mid-flight): treat the
      // circuit as open again so attempts cannot pile up.
      this.openCircuit(provider, state, now);
      throw new ProviderCircuitOpenError(provider, this.config.probeIntervalMs);
    }

    if (now < state.probeAt) {
      throw new ProviderCircuitOpenError(provider, state.probeAt - now);
    }

    state.state = 'half_open';
    state.probeAt = now + this.config.probeIntervalMs;
    this.logger.log(
      `Provider "${provider}" probe window opened after ${Math.round(this.config.probeIntervalMs / 1000)}s of cutoff`,
    );
    this.publishCircuitMetrics(provider, state, now);
  }

  /** Record a successful delivery: resets failures and closes the circuit. */
  recordSuccess(
    provider: NotificationProvider,
    now: number = Date.now(),
  ): void {
    const state = this.getState(provider);
    const wasCutOff = state.state !== 'closed';

    state.state = 'closed';
    state.consecutiveFailures = 0;
    state.probeAt = 0;
    state.openedAt = null;
    state.outcomes.push({ ok: true, at: now });
    this.pruneOutcomes(state, now);

    if (wasCutOff) {
      this.logger.log(
        `Provider "${provider}" health probe succeeded; circuit closed`,
      );
    }
    this.publishCircuitMetrics(provider, state, now);
  }

  /**
   * Record a failed delivery attempt. Once `failureThreshold` consecutive
   * failures are seen the circuit opens for one probe window.
   */
  recordFailure(
    provider: NotificationProvider,
    now: number = Date.now(),
  ): void {
    const state = this.getState(provider);

    state.consecutiveFailures += 1;
    state.outcomes.push({ ok: false, at: now });
    this.pruneOutcomes(state, now);

    if (state.consecutiveFailures >= this.config.failureThreshold) {
      const wasCutOff = state.state !== 'closed';
      this.openCircuit(provider, state, now);
      if (!wasCutOff) {
        this.logger.warn(
          `Provider "${provider}" failed ${state.consecutiveFailures} times in a row — opening the circuit for ${Math.round(this.config.probeIntervalMs / 1000)}s`,
        );
      }
      return;
    }

    this.publishCircuitMetrics(provider, state, now);
  }

  /** Failure rate [0, 1] over the sliding window, for a single provider. */
  getFailureRate(
    provider: NotificationProvider,
    now: number = Date.now(),
  ): number {
    const state = this.getState(provider);
    this.pruneOutcomes(state, now);
    if (state.outcomes.length === 0) return 0;
    const failures = state.outcomes.filter(outcome => !outcome.ok).length;
    return failures / state.outcomes.length;
  }

  getSnapshot(provider: NotificationProvider, now: number = Date.now()) {
    const state = this.getState(provider);
    return {
      provider,
      state: state.state,
      consecutiveFailures: state.consecutiveFailures,
      failureRate: Math.round(this.getFailureRate(provider, now) * 1000) / 1000,
      probeAt: state.probeAt,
      openedAt: state.openedAt,
    };
  }

  getAllSnapshots(now: number = Date.now()) {
    return (['email', 'sms'] as const).map(provider =>
      this.getSnapshot(provider, now),
    );
  }

  // ── internals ─────────────────────────────────────────────────

  private getState(provider: NotificationProvider): ProviderState {
    let state = this.states.get(provider);
    if (!state) {
      state = {
        state: 'closed',
        consecutiveFailures: 0,
        probeAt: 0,
        openedAt: null,
        outcomes: [],
      };
      this.states.set(provider, state);
    }
    return state;
  }

  private openCircuit(
    provider: NotificationProvider,
    state: ProviderState,
    now: number,
  ): void {
    state.state = 'open';
    state.probeAt = now + this.config.probeIntervalMs;
    state.openedAt = now;
    this.publishCircuitMetrics(provider, state, now);
  }

  private pruneOutcomes(state: ProviderState, now: number): void {
    const windowStart = now - this.config.failureWindowMs;
    while (state.outcomes.length > 0 && state.outcomes[0].at < windowStart) {
      state.outcomes.shift();
    }
  }

  private publishCircuitMetrics(
    provider: NotificationProvider,
    state: ProviderState,
    now: number,
  ): void {
    this.metricsService.setGauge(
      'notification_provider_failure_rate',
      this.getFailureRate(provider, now),
      { provider },
    );
    this.metricsService.setGauge(
      'notification_circuit_state',
      CIRCUIT_STATE_CODES[state.state],
      { provider },
    );
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

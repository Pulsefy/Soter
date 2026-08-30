import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ProviderStatus = 'healthy' | 'degraded' | 'down';

export interface ProviderHealthSnapshot {
  status: ProviderStatus;
  failureRate: number;
  totalRequests: number;
  lastFailure: string | null;
  lastSuccess: string | null;
}

interface ProviderEvent {
  success: boolean;
  timestamp: number;
}

/**
 * Tracks provider health centrally using a sliding window of recent
 * outcomes (issue #770).
 *
 * Any service can inject this to `recordSuccess` / `recordFailure` after
 * interacting with an external provider (OCR, LLM, Stellar RPC, email,
 * SMS, etc.).  The health controller then exposes an aggregate without
 * leaking sensitive details such as error messages or credentials.
 */
@Injectable()
export class ProviderHealthRegistryService {
  private readonly logger = new Logger(ProviderHealthRegistryService.name);

  /** Sliding window size in milliseconds. */
  private readonly windowMs: number;

  /** Failure-rate threshold [0, 1] above which the provider is considered degraded. */
  private readonly degradedThreshold: number;

  /** Failure-rate threshold [0, 1] above which the provider is considered down. */
  private readonly downThreshold: number;

  /** Per-provider event ring buffers. */
  private readonly events = new Map<string, ProviderEvent[]>();

  /** Per-provider timestamps for the most recent success/failure. */
  private readonly lastSuccess = new Map<string, number>();
  private readonly lastFailure = new Map<string, number>();

  constructor(private readonly config: ConfigService) {
    this.windowMs = this.parsePositiveInt(
      config.get<string>('PROVIDER_HEALTH_WINDOW_MS'),
      60_000,
    );
    this.degradedThreshold = this.parseThreshold(
      config.get<string>('PROVIDER_HEALTH_DEGRADED_THRESHOLD'),
      0.3,
    );
    this.downThreshold = this.parseThreshold(
      config.get<string>('PROVIDER_HEALTH_DOWN_THRESHOLD'),
      0.7,
    );
  }

  /**
   * Record a successful interaction with `provider`.
   */
  recordSuccess(provider: string): void {
    const now = Date.now();
    this.pushEvent(provider, { success: true, timestamp: now });
    this.lastSuccess.set(provider, now);
  }

  /**
   * Record a failed interaction with `provider`.
   * `_error` is intentionally unused — we do not store raw error text to
   * prevent sensitive information from leaking through the health endpoint.
   */
  recordFailure(provider: string, _error?: unknown): void {
    const now = Date.now();
    this.pushEvent(provider, { success: false, timestamp: now });
    this.lastFailure.set(provider, now);
    this.logger.warn(`Provider "${provider}" recorded a failure`);
  }

  /**
   * Derive the current status for a single provider.
   */
  getStatus(provider: string): ProviderStatus {
    return this.computeSnapshot(provider).status;
  }

  /**
   * Return a snapshot for every known provider.
   * Shape is intentionally free of sensitive data (no error messages,
   * no credentials, no stack traces).
   */
  getAllStatuses(): Record<string, ProviderHealthSnapshot> {
    const result: Record<string, ProviderHealthSnapshot> = {};
    for (const provider of this.events.keys()) {
      result[provider] = this.computeSnapshot(provider);
    }
    return result;
  }

  // ── internals ─────────────────────────────────────────────────

  private computeSnapshot(provider: string): ProviderHealthSnapshot {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const all = (this.events.get(provider) ?? []).filter(
      e => e.timestamp >= windowStart,
    );

    // No data → healthy (we cannot claim degradation without evidence).
    if (all.length === 0) {
      return {
        status: 'healthy',
        failureRate: 0,
        totalRequests: 0,
        lastFailure: this.isoOrNull(this.lastFailure.get(provider)),
        lastSuccess: this.isoOrNull(this.lastSuccess.get(provider)),
      };
    }

    const failures = all.filter(e => !e.success).length;
    const failureRate = failures / all.length;

    let status: ProviderStatus = 'healthy';
    if (failureRate >= this.downThreshold) {
      status = 'down';
    } else if (failureRate >= this.degradedThreshold) {
      status = 'degraded';
    }

    return {
      status,
      failureRate: Math.round(failureRate * 1000) / 1000,
      totalRequests: all.length,
      lastFailure: this.isoOrNull(this.lastFailure.get(provider)),
      lastSuccess: this.isoOrNull(this.lastSuccess.get(provider)),
    };
  }

  private pushEvent(provider: string, event: ProviderEvent): void {
    if (!this.events.has(provider)) {
      this.events.set(provider, []);
    }
    const buf = this.events.get(provider)!;
    buf.push(event);

    // Prune events older than the window to bound memory.
    const windowStart = event.timestamp - this.windowMs;
    while (buf.length > 0 && buf[0].timestamp < windowStart) {
      buf.shift();
    }
  }

  private isoOrNull(ts: number | undefined): string | null {
    return ts != null ? new Date(ts).toISOString() : null;
  }

  private parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (raw == null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : fallback;
  }

  private parseThreshold(raw: string | undefined, fallback: number): number {
    if (raw == null) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
      ? parsed
      : fallback;
  }
}

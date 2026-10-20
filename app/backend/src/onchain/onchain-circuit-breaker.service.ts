import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../observability/metrics/metrics.service';
import { OnchainAdapter } from './onchain.adapter';

export type OnchainCircuitState = 'closed' | 'open' | 'half_open';

export interface OnchainCircuitSnapshot {
  state: OnchainCircuitState;
  failureCount: number;
  failureThreshold: number;
  failureWindowMs: number;
  resetTimeoutMs: number;
  retryAfterMs: number;
}

@Injectable()
export class OnchainCircuitBreakerService {
  private readonly failureThreshold: number;
  private readonly failureWindowMs: number;
  private readonly resetTimeoutMs: number;
  private state: OnchainCircuitState = 'closed';
  private failures: number[] = [];
  private openedAt = 0;

  constructor(
    config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    this.failureThreshold = this.positiveConfig(
      config,
      'ONCHAIN_CIRCUIT_BREAKER_FAILURE_THRESHOLD',
      5,
    );
    this.failureWindowMs = this.positiveConfig(
      config,
      'ONCHAIN_CIRCUIT_BREAKER_WINDOW_MS',
      30000,
    );
    this.resetTimeoutMs = this.positiveConfig(
      config,
      'ONCHAIN_CIRCUIT_BREAKER_RESET_TIMEOUT_MS',
      30000,
    );
    this.recordStateMetric();
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.acquire();
    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  getSnapshot(): OnchainCircuitSnapshot {
    const now = Date.now();
    this.pruneFailures(now);
    return {
      state: this.state,
      failureCount: this.failures.length,
      failureThreshold: this.failureThreshold,
      failureWindowMs: this.failureWindowMs,
      resetTimeoutMs: this.resetTimeoutMs,
      retryAfterMs:
        this.state === 'open'
          ? Math.max(0, this.openedAt + this.resetTimeoutMs - now)
          : 0,
    };
  }

  protect<T extends OnchainAdapter>(adapter: T): T {
    return new Proxy(adapter, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== 'function') {
          return value;
        }
        return (...args: unknown[]) =>
          this.execute(
            () => Reflect.apply(value, target, args) as Promise<unknown>,
          );
      },
    });
  }

  private acquire(): void {
    const now = Date.now();
    this.pruneFailures(now);

    if (this.state === 'open') {
      if (now < this.openedAt + this.resetTimeoutMs) {
        throw new Error(
          `onchain RPC unavailable (circuit open; retry in ${this.openedAt + this.resetTimeoutMs - now}ms)`,
        );
      }
      this.setState('half_open');
      return;
    }

    if (this.state === 'half_open') {
      throw new Error(
        'onchain RPC unavailable (circuit probe already in progress)',
      );
    }
  }

  private recordSuccess(): void {
    if (this.state === 'half_open') {
      this.failures = [];
      this.setState('closed');
      return;
    }
    this.pruneFailures(Date.now());
  }

  private recordFailure(): void {
    const now = Date.now();
    if (this.state === 'half_open') {
      this.openedAt = now;
      this.setState('open');
      return;
    }

    this.pruneFailures(now);
    this.failures.push(now);
    if (this.failures.length >= this.failureThreshold) {
      this.openedAt = now;
      this.setState('open');
    }
  }

  private pruneFailures(now: number): void {
    const cutoff = now - this.failureWindowMs;
    this.failures = this.failures.filter(failedAt => failedAt > cutoff);
  }

  private setState(state: OnchainCircuitState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.recordStateMetric();
  }

  private recordStateMetric(): void {
    const stateValue =
      this.state === 'closed' ? 0 : this.state === 'half_open' ? 0.5 : 1;
    this.metrics.setGauge('onchain_rpc_circuit_state', stateValue);
  }

  private positiveConfig(
    config: ConfigService,
    key: string,
    fallback: number,
  ): number {
    const configured = Number(config.get<string>(key));
    return Number.isFinite(configured) && configured > 0
      ? configured
      : fallback;
  }
}

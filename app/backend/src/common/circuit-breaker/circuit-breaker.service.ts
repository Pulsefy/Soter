import { Injectable, Logger } from '@nestjs/common';

import { CircuitState } from './dto/circuit-breaker-status.dto';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. */
  failureThreshold?: number;
  /** Number of consecutive successes in half-open state to close the circuit. */
  successThreshold?: number;
  /** Time in ms to wait in open state before allowing a trial request. */
  resetTimeoutMs?: number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  openedAt?: number;
}

const DEFAULT_OPTIONS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  successThreshold: 2,
  resetTimeoutMs: 30_000,
};

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<string, CircuitBreakerState>();
  private readonly options = new Map<string, Required<CircuitBreakerOptions>>();

  /** Register a circuit breaker with optional overrides. */
  register(name: string, options?: CircuitBreakerOptions): void {
    this.options.set(name, { ...DEFAULT_OPTIONS, ...options });
    if (!this.breakers.has(name)) {
      this.breakers.set(name, { state: 'closed', failures: 0, successes: 0 });
    }
  }

  /** Return true if a request may proceed for the given breaker. */
  allowRequest(name: string): boolean {
    const breaker = this.getOrCreate(name);
    if (breaker.state === 'closed') {
      return true;
    }
    if (breaker.state === 'half-open') {
      return true;
    }
    // open: check reset timeout
    const opts = this.getOptions(name);
    if (breaker.openedAt !== undefined && Date.now() - breaker.openedAt >= opts.resetTimeoutMs) {
      breaker.state = 'half-open';
      breaker.successes = 0;
      this.logger.log(`Circuit breaker "${name}" transitioned to half-open`);
      return true;
    }
    return false;
  }

  /** Record a successful call for the given breaker. */
  recordSuccess(name: string): void {
    const breaker = this.getOrCreate(name);
    breaker.failures = 0;
    if (breaker.state === 'half-open') {
      breaker.successes += 1;
      const opts = this.getOptions(name);
      if (breaker.successes >= opts.successThreshold) {
        breaker.state = 'closed';
        breaker.successes = 0;
        breaker.openedAt = undefined;
        this.logger.log(`Circuit breaker "${name}" closed`);
      }
    }
  }

  /** Record a failed call for the given breaker. */
  recordFailure(name: string): void {
    const breaker = this.getOrCreate(name);
    breaker.failures += 1;
    breaker.successes = 0;
    const opts = this.getOptions(name);
    if (breaker.state === 'half-open' || breaker.failures >= opts.failureThreshold) {
      breaker.state = 'open';
      breaker.openedAt = Date.now();
      this.logger.warn(`Circuit breaker "${name}" opened`);
    }
  }

  /** Return the current state of a breaker. */
  getState(name: string): CircuitState {
    return this.getOrCreate(name).state;
  }

  /** Return a snapshot of all registered breakers. */
  getAllStates(): Array<{ name: string; state: CircuitState; failures: number; successes: number }> {
    return Array.from(this.breakers.entries()).map(([name, breaker]) => ({
      name,
      state: breaker.state,
      failures: breaker.failures,
      successes: breaker.successes,
    }));
  }

  /** Reset a breaker to closed state. */
  reset(name: string): void {
    this.breakers.set(name, { state: 'closed', failures: 0, successes: 0 });
  }

  private getOrCreate(name: string): CircuitBreakerState {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = { state: 'closed', failures: 0, successes: 0 };
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  private getOptions(name: string): Required<CircuitBreakerOptions> {
    return this.options.get(name) ?? DEFAULT_OPTIONS;
  }
}

import { Injectable, Logger } from '@interfaces/nestjs';
import { ConfigService } from '@interfaces/config';

import { CircuitBreakerService } from './circuit-breaker.service';
import {
  CircuitBreakerEntryDto,
  CircuitBreakerStatusDto,
} from './dto/circuit-breaker-status.dto';

const DEFAULT_AI_BASE_URL = 'http://localhost:3001';
const DEFAULT_TIMEOUT_MS = 2_000;

@Injectable()
export class AdminCircuitBreakerService {
  private readonly logger = new Logger(AdminCircuitBreakerService.name);

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly config: ConfigService,
  ) {}

  async getAggregatedStatus(): Promise<CircuitBreakerStatusDto> {
    const backend = this.getBackendState();
    const ai = await this.getAiState();
    const degraded = [...backend, ...ai].some((entry) => entry.state !== 'closed');

    return {
      backend,
      ai,
      degraded,
      timestamp: new Date().toISOString(),
    };
  }

  private getBackendState(): CircuitBreakerEntryDto[] {
    return this.circuitBreaker.getAllStates().map((entry) => ({
      name: entry.name,
      state: entry.state,
      detail: `failures=${entry.failures} successes=${entry.successes}`,
    }));
  }

  private async getAiState(): Promise<CircuitBreakerEntryDto[]> {
    const baseUrl = this.config.get<string>('AI_SERVICE_URL') ?? DEFAULT_AI_BASE_URL;
    const timeoutMs = Number(
      this.config.get<string>('AI_SERVICE_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS,
    );
    const url = `${baseUrl.replace(/\/$/, '')}/admin/circuit-breakers`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(`AI circuit breaker endpoint returned status ${response.status}`);
        return this.unknownAiState(`status ${response.status}`);
      }

      const body = (await response.json()) as unknown;
      return this.normalizeAiResponse(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Unable to reach AI circuit breaker endpoint: ${message}`);
      return this.unknownAiState(message);
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeAiResponse(body: unknown): CircuitBreakerEntryDto[] {
    if (!body || typeof body !== 'object') {
      return this.unknownAiState('invalid response');
    }

    const record = body as Record<string, unknown>;
    const candidates = Array.isArray(record.breakers)
      ? record.breakers
      : Array.isArray(record.circuit_breakers)
        ? record.circuit_breakers
        : Array.isArray(record.states)
          ? record.states
          : undefined;

    if (!candidates) {
      return this.unknownAiState('unrecognized response shape');
    }

    return (candidates as unknown[]).map((item, index) => {
      const entry = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const name = typeof entry.name === 'string' ? entry.name : `ai-breaker-${index}`;
      const rawState = typeof entry.state === 'string' ? entry.state : 'unknown';
      const state = this.normalizeState(rawState);
      const detail = typeof entry.detail === 'string' ? entry.detail : undefined;
      return { name, state, detail };
    });
  }

  private normalizeState(rawState: string): CircuitBreakerEntryDto['state'] {
    const normalized = rawState.toLowerCase().replace(/_/g, '-');
    if (normalized === 'closed' || normalized === 'half-open' || normalized === 'open') {
      return normalized;
    }
    return 'unknown';
  }

  private unknownAiState(reason: string): CircuitBreakerEntryDto[] {
    return [{ name: 'ai', state: 'unknown', detail: reason }];
  }
}

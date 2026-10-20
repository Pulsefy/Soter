import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../observability/metrics/metrics.service';
import { OnchainCircuitBreakerService } from './onchain-circuit-breaker.service';

describe('OnchainCircuitBreakerService', () => {
  let now: number;
  let breaker: OnchainCircuitBreakerService;
  const setGauge = jest.fn();

  const createBreaker = (values: Record<string, string>) => {
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
    const metrics = { setGauge } as unknown as MetricsService;
    return new OnchainCircuitBreakerService(config, metrics);
  };

  beforeEach(() => {
    now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    setGauge.mockClear();
    breaker = createBreaker({
      ONCHAIN_CIRCUIT_BREAKER_FAILURE_THRESHOLD: '2',
      ONCHAIN_CIRCUIT_BREAKER_WINDOW_MS: '1000',
      ONCHAIN_CIRCUIT_BREAKER_RESET_TIMEOUT_MS: '500',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens after the configured number of failures in the failure window', async () => {
    const fail = () => Promise.reject(new Error('RPC request failed'));

    await expect(breaker.execute(fail)).rejects.toThrow('RPC request failed');
    await expect(breaker.execute(fail)).rejects.toThrow('RPC request failed');

    expect(breaker.getSnapshot()).toMatchObject({
      state: 'open',
      failureCount: 2,
      retryAfterMs: 500,
    });
    expect(setGauge).toHaveBeenLastCalledWith('onchain_rpc_circuit_state', 1);
  });

  it('fails fast without invoking calls while open', async () => {
    const operation = jest
      .fn()
      .mockRejectedValue(new Error('RPC request failed'));
    await breaker.execute(operation).catch(() => undefined);
    await breaker.execute(operation).catch(() => undefined);
    operation.mockClear();

    await expect(breaker.execute(operation)).rejects.toThrow(
      'onchain RPC unavailable',
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('allows a recovery probe after the reset timeout and closes on success', async () => {
    const fail = () => Promise.reject(new Error('RPC request failed'));
    await expect(breaker.execute(fail)).rejects.toThrow('RPC request failed');
    await expect(breaker.execute(fail)).rejects.toThrow('RPC request failed');
    now += 500;

    await expect(breaker.execute(() => 'healthy')).resolves.toBe('healthy');
    expect(breaker.getSnapshot()).toMatchObject({
      state: 'closed',
      failureCount: 0,
      retryAfterMs: 0,
    });
    expect(setGauge).toHaveBeenLastCalledWith('onchain_rpc_circuit_state', 0);
  });

  it('expires failures outside the configured failure window', async () => {
    const fail = () => Promise.reject(new Error('RPC request failed'));
    await expect(breaker.execute(fail)).rejects.toThrow('RPC request failed');
    now += 1001;
    await expect(breaker.execute(fail)).rejects.toThrow('RPC request failed');

    expect(breaker.getSnapshot()).toMatchObject({
      state: 'closed',
      failureCount: 1,
    });
  });
});

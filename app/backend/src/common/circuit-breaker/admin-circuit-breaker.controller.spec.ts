import { TestingModule } from '@interfaces/testing';
import { ConfigService } from '@interfaces/config';

import { AdminCircuitBreakerController } from './admin-circuit-breaker.controller';
import { AdminCircuitBreakerService } from './admin-circuit-breaker.service';
import { CircuitBreakerService } from './circuit-breaker.service';

describe('AdminCircuitBreakerController', () => {
  let controller: AdminCircuitBreakerController;
  let circuitBreaker: CircuitBreakerService;
  const fetchMock = jest.fn();

  beforeEach(async () => {
    fetchMock.reset();
    global.fetch = fetchMock as unknown as typeof fetch;

    const moduleRef = await TestingModule.createTestingModule({
      controllers: [AdminCircuitBreakerController],
      providers: [
        CircuitBreakerService,
        AdminCircuitBreakerService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'AI_SERVICE_URL') {
                return 'http://ai-service:3001';
              }
              return undefined;
            },
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(AdminCircuitBreakerController);
    circuitBreaker = moduleRef.get(CircuitBreakerService);
  });

  it('aggregates a healthy AI service with the backend state', async () => {
    circuitBreaker.register('onchain');
    circuitBreaker.recordSuccess('onchain');

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        breakers: [
          { name: 'ai-inference', state: 'closed' },
          { name: 'ai-embeddings', state: 'half-open' },
        ],
      }),
    });

    const result = await controller.getStatus();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/admin/circuit-breakers');
    expect(result.backend).toEqual([
      expect.objectContaining({ name: 'onchain', state: 'closed' }),
    ]);
    expect(result.ai).toEqual([
      { name: 'ai-inference', state: 'closed', detail: undefined },
      { name: 'ai-embeddings', state: 'half-open', detail: undefined },
    ]);
    expect(result.degraded).toBe(true);
    expect(typeof result.timestamp).toBe('string');
  });

  it('degrades gracefully when the AI service is unreachable', async () => {
    circuitBreaker.register('onchain');

    fetchMock.mockRejectedValue(new Error('connection refused'));

    const result = await controller.getStatus();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.backend).toEqual([
      expect.objectContaining({ name: 'onchain', state: 'closed' }),
    ]);
    expect(result.ai).toEqual([
      { name: 'ai', state: 'unknown', detail: 'connection refused' },
    ]);
    expect(result.degraded).toBe(true);
  });
});

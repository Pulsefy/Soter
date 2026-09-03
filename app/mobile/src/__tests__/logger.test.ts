import { fetchHealthStatus } from '../services/api';
import { StructuredLogger, createStructuredLogger } from '../services/logger';

describe('structured mobile logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    StructuredLogger.resetForTests();
  });

  it('redacts sensitive values and preserves correlation ids in log records', () => {
    const logger = createStructuredLogger({ maxEntries: 25, maxBytes: 200000 });
    logger.setCorrelationId('corr-redact-123');

    logger.info('backend.request', {
      url: 'https://api.example.com/health?token=abc123',
      headers: {
        Authorization: 'Bearer my.jwt.token',
        email: 'field.staff@example.com',
      },
      payload: { password: 'hunter2', secretKey: 'SAAAAAAAAAAAAA' },
    });

    const entries = logger.getEntries();
    const serialized = JSON.stringify(entries);

    expect(entries[0]?.correlationId).toBe('corr-redact-123');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('field.staff@example.com');
    expect(serialized).not.toContain('my.jwt.token');
  });

  it('adds correlation headers to backend health requests', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        service: 'backend',
        version: '1.0.0',
        environment: 'development',
        timestamp: new Date().toISOString(),
      }),
    } as any);

    const logger = StructuredLogger.getInstance();
    logger.setCorrelationId('corr-health-456');

    await fetchHealthStatus();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/health'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-correlation-id': 'corr-health-456',
          'x-request-id': 'corr-health-456',
        }),
      }),
    );
  });
});

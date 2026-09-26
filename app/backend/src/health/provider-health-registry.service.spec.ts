import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProviderHealthRegistryService } from './provider-health-registry.service';

describe('ProviderHealthRegistryService', () => {
  let service: ProviderHealthRegistryService;

  const buildService = async (
    envOverrides: Record<string, string> = {},
  ): Promise<ProviderHealthRegistryService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderHealthRegistryService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => envOverrides[key] ?? undefined,
          },
        },
      ],
    }).compile();

    return module.get<ProviderHealthRegistryService>(
      ProviderHealthRegistryService,
    );
  };

  beforeEach(async () => {
    service = await buildService();
  });

  describe('initial state', () => {
    it('should return "healthy" for an unknown provider', () => {
      expect(service.getStatus('ocr')).toBe('healthy');
    });

    it('should return an empty record when no providers are registered', () => {
      expect(service.getAllStatuses()).toEqual({});
    });
  });

  describe('recording outcomes', () => {
    it('should stay healthy after only successes', () => {
      service.recordSuccess('email');
      service.recordSuccess('email');
      service.recordSuccess('email');

      expect(service.getStatus('email')).toBe('healthy');
    });

    it('should transition to degraded when failure rate exceeds degraded threshold', async () => {
      // Default degraded threshold is 0.3
      // 4 successes + 2 failures = 33% failure rate → degraded
      const svc = await buildService({
        PROVIDER_HEALTH_DEGRADED_THRESHOLD: '0.3',
        PROVIDER_HEALTH_DOWN_THRESHOLD: '0.7',
      });

      for (let i = 0; i < 4; i++) svc.recordSuccess('llm');
      for (let i = 0; i < 2; i++) svc.recordFailure('llm');

      expect(svc.getStatus('llm')).toBe('degraded');
    });

    it('should transition to down when failure rate exceeds down threshold', async () => {
      // Default down threshold is 0.7
      // 2 successes + 8 failures = 80% failure rate → down
      const svc = await buildService({
        PROVIDER_HEALTH_DEGRADED_THRESHOLD: '0.3',
        PROVIDER_HEALTH_DOWN_THRESHOLD: '0.7',
      });

      for (let i = 0; i < 2; i++) svc.recordSuccess('ocr');
      for (let i = 0; i < 8; i++) svc.recordFailure('ocr');

      expect(svc.getStatus('ocr')).toBe('down');
    });

    it('should track providers independently', () => {
      service.recordSuccess('email');
      service.recordFailure('sms');
      service.recordFailure('sms');
      service.recordFailure('sms');

      expect(service.getStatus('email')).toBe('healthy');
      // 3/3 = 100% failure rate → down
      expect(service.getStatus('sms')).toBe('down');
    });
  });

  describe('sliding window recovery', () => {
    it('should recover to healthy when old failures slide out of the window', async () => {
      // Use a tiny window of 50ms so we can test expiry quickly
      const svc = await buildService({
        PROVIDER_HEALTH_WINDOW_MS: '50',
        PROVIDER_HEALTH_DEGRADED_THRESHOLD: '0.3',
        PROVIDER_HEALTH_DOWN_THRESHOLD: '0.7',
      });

      // Record failures to push to down
      for (let i = 0; i < 5; i++) svc.recordFailure('ocr');
      expect(svc.getStatus('ocr')).toBe('down');

      // Wait for the window to expire
      await new Promise(resolve => setTimeout(resolve, 80));

      // New successes should dominate
      svc.recordSuccess('ocr');
      svc.recordSuccess('ocr');
      expect(svc.getStatus('ocr')).toBe('healthy');
    });
  });

  describe('getAllStatuses', () => {
    it('should return correct shape for all known providers', () => {
      service.recordSuccess('email');
      service.recordFailure('sms');

      const statuses = service.getAllStatuses();

      expect(Object.keys(statuses)).toEqual(
        expect.arrayContaining(['email', 'sms']),
      );

      // email: 1 success, 0 failures → healthy
      expect(statuses['email']).toEqual({
        status: 'healthy',
        failureRate: 0,
        totalRequests: 1,
        lastFailure: null,
        lastSuccess: expect.any(String),
      });

      // sms: 0 successes, 1 failure → down (100% failure rate)
      expect(statuses['sms']).toEqual({
        status: 'down',
        failureRate: 1,
        totalRequests: 1,
        lastFailure: expect.any(String),
        lastSuccess: null,
      });
    });

    it('should not include sensitive information in the snapshot', () => {
      service.recordFailure('ocr', new Error('API key abc123 is invalid'));

      const statuses = service.getAllStatuses();
      const snapshot = JSON.stringify(statuses);

      expect(snapshot).not.toContain('abc123');
      expect(snapshot).not.toContain('API key');
      expect(snapshot).not.toContain('invalid');
    });
  });

  describe('configuration', () => {
    it('should use custom thresholds from config', async () => {
      const svc = await buildService({
        PROVIDER_HEALTH_DEGRADED_THRESHOLD: '0.5',
        PROVIDER_HEALTH_DOWN_THRESHOLD: '0.9',
      });

      // 3 successes + 2 failures = 40% → still healthy with 0.5 threshold
      for (let i = 0; i < 3; i++) svc.recordSuccess('llm');
      for (let i = 0; i < 2; i++) svc.recordFailure('llm');

      expect(svc.getStatus('llm')).toBe('healthy');
    });

    it('should fall back to defaults for invalid config values', async () => {
      const svc = await buildService({
        PROVIDER_HEALTH_DEGRADED_THRESHOLD: 'not-a-number',
        PROVIDER_HEALTH_DOWN_THRESHOLD: '2.0',
        PROVIDER_HEALTH_WINDOW_MS: '-100',
      });

      // Should use default thresholds (0.3 / 0.7) and default window
      for (let i = 0; i < 7; i++) svc.recordSuccess('test');
      for (let i = 0; i < 3; i++) svc.recordFailure('test');

      // 3/10 = 30% = threshold boundary → degraded
      expect(svc.getStatus('test')).toBe('degraded');
    });
  });
});

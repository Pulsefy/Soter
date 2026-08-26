import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CostAwareThrottlerGuard } from './throttle.guard';
import { MetricsService } from '../../observability/metrics/metrics.service';
import { ThrottlerException } from '@nestjs/throttler';
import { ApiKeyScope } from '../../api-keys/api-key-scope.enum';
import { SCOPE_RATE_LIMIT_MULTIPLIERS } from '../config/rate-limit.config';

describe('CostAwareThrottlerGuard', () => {
  let guard: CostAwareThrottlerGuard;
  let metricsService: jest.Mocked<MetricsService>;
  let reflector: jest.Mocked<Reflector>;
  let options: any;
  let storageService: any;

  beforeEach(() => {
    metricsService = {
      incrementRateLimitRejection: jest.fn(),
    } as unknown as jest.Mocked<MetricsService>;

    reflector = {
      get: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<Reflector>;

    options = {};
    storageService = {
      increment: jest.fn().mockResolvedValue({ totalHits: 1, timeToExpire: 60 }),
    };

    guard = new (class extends CostAwareThrottlerGuard {
      constructor() {
        super(options, storageService, reflector);
        (this as any).metricsService = metricsService;
      }
    })();
  });

  describe('getTracker', () => {
    it('should track by API key if present', async () => {
      const req = { user: { authType: 'apiKey', apiKeyId: 'test-key-id' } };
      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe('apikey:test-key-id');
    });

    it('should track by IP if API key is not present', async () => {
      const req = { ips: ['127.0.0.1'], ip: '127.0.0.1' };
      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe('127.0.0.1');
    });
  });

  describe('handleRequest', () => {
    it('should multiply limits based on scopes and track rejections', async () => {
      const req = {
        user: {
          authType: 'apiKey',
          apiKeyId: 'key-1',
          scopes: [ApiKeyScope.read, ApiKeyScope.webhook],
        },
        path: '/api/v1/test',
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => ({ header: jest.fn() }),
        }),
      } as unknown as ExecutionContext;

      const baseLimit = 10;
      const expectedMultiplier = SCOPE_RATE_LIMIT_MULTIPLIERS[ApiKeyScope.webhook];
      const expectedLimit = baseLimit * expectedMultiplier;

      // Mock ThrottlerGuard super.handleRequest using prototype
      const handleRequestSpy = jest.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'handleRequest').mockResolvedValue(true);

      const result = await (guard as any).handleRequest(context, baseLimit, 60, { name: 'default' }, async () => 'test-tracker');
      
      expect(result).toBe(true);
      expect(handleRequestSpy).toHaveBeenCalledWith(
        context,
        expectedLimit,
        60,
        { name: 'default' },
        expect.any(Function)
      );
    });
    
    it('should increment metric on rejection', async () => {
      const req = {
        user: { authType: 'apiKey', apiKeyId: 'key-1' },
        path: '/api/v1/test',
      };

      const context = {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => ({ header: jest.fn() }),
        }),
      } as unknown as ExecutionContext;

      jest.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'handleRequest').mockRejectedValue(new ThrottlerException());

      await expect((guard as any).handleRequest(context, 10, 60, { name: 'default' }, async () => 'test')).rejects.toThrow(ThrottlerException);
      
      expect(metricsService.incrementRateLimitRejection).toHaveBeenCalledWith('apikey', 'default');
    });
  });
});

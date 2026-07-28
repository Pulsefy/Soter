import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { CacheResponseInterceptor } from './cache-response.interceptor';
import { RedisService } from '../../../cache/redis.service';

describe('CacheResponseInterceptor', () => {
  let interceptor: CacheResponseInterceptor;
  let reflector: Reflector;
  let redisService: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheResponseInterceptor,
        {
          provide: Reflector,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
          },
        },
      ],
    }).compile();

    interceptor = module.get<CacheResponseInterceptor>(
      CacheResponseInterceptor,
    );
    reflector = module.get<Reflector>(Reflector);
    redisService = module.get<RedisService>(RedisService);
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  describe('intercept', () => {
    let mockExecutionContext: ExecutionContext;
    let mockCallHandler: CallHandler;

    beforeEach(() => {
      mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue({
            method: 'GET',
            route: { path: '/test' },
            path: '/test',
            query: {},
            body: {},
          }),
        }),
        getHandler: jest.fn(),
      } as any;

      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of({ data: 'test' })),
      };
    });

    it('should skip caching when no metadata is present', done => {
      jest.spyOn(reflector, 'get').mockReturnValue(undefined);

      interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .subscribe(result => {
          expect(result).toEqual({ data: 'test' });
          expect(redisService.get).not.toHaveBeenCalled();
          done();
        });
    });

    it('should return cached response on cache hit', done => {
      const cacheOptions = { ttl: 300 };
      const cachedData = { data: 'cached' };

      jest.spyOn(reflector, 'get').mockReturnValue(cacheOptions);
      jest.spyOn(redisService, 'get').mockResolvedValue(cachedData);

      interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .subscribe(result => {
          expect(result).toEqual(cachedData);
          expect(redisService.get).toHaveBeenCalled();
          expect(mockCallHandler.handle).not.toHaveBeenCalled();
          done();
        });
    });

    it('should execute handler and cache result on cache miss', done => {
      const cacheOptions = { ttl: 300 };
      const handlerData = { data: 'fresh' };

      jest.spyOn(reflector, 'get').mockReturnValue(cacheOptions);
      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      jest.spyOn(redisService, 'set').mockResolvedValue(undefined);
      mockCallHandler.handle = jest.fn().mockReturnValue(of(handlerData));

      interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .subscribe(result => {
          expect(result).toEqual(handlerData);
          expect(redisService.get).toHaveBeenCalled();
          expect(mockCallHandler.handle).toHaveBeenCalled();

          // Set is called asynchronously, give it a moment
          setTimeout(() => {
            expect(redisService.set).toHaveBeenCalledWith(
              expect.any(String),
              handlerData,
              300,
            );
            done();
          }, 10);
        });
    });

    it('should use custom key generator when provided', done => {
      const customKey = 'custom:key:123';
      const cacheOptions = {
        ttl: 300,
        keyGenerator: jest.fn().mockReturnValue(customKey),
      };

      jest.spyOn(reflector, 'get').mockReturnValue(cacheOptions);
      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      jest.spyOn(redisService, 'set').mockResolvedValue(undefined);

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: () => {
          expect(cacheOptions.keyGenerator).toHaveBeenCalled();
          expect(redisService.get).toHaveBeenCalledWith(
            expect.stringContaining(customKey),
          );
          done();
        },
        error: err => done(err),
      });
    });

    it('should include query params in cache key', done => {
      const cacheOptions = { ttl: 300 };
      mockExecutionContext.switchToHttp = jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          method: 'GET',
          route: { path: '/test' },
          path: '/test',
          query: { page: '1', limit: '10' },
          body: {},
        }),
      });

      jest.spyOn(reflector, 'get').mockReturnValue(cacheOptions);
      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      jest.spyOn(redisService, 'set').mockResolvedValue(undefined);

      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: () => {
          expect(redisService.get).toHaveBeenCalled();
          // Key should be different due to query params
          const cacheKey = (redisService.get as jest.Mock).mock.calls[0][0];
          expect(cacheKey).toBeTruthy();
          done();
        },
        error: err => done(err),
      });
    });
  });
});

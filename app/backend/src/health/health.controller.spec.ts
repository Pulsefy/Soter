import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MetadataService } from './metadata.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';
import { ONCHAIN_ADAPTER_TOKEN } from '../onchain/onchain.adapter';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ProviderHealthRegistryService } from './provider-health-registry.service';

describe('HealthController', () => {
  let app: INestApplication;
  let healthService: HealthService;

  const configValues: Record<string, string | undefined> = {
    NODE_ENV: 'test',
    // Disable readiness caching by default so each test observes fresh checks.
    HEALTHCHECK_CACHE_TTL_MS: '0',
  };

  const configMock = {
    get: jest.fn((key: string) => configValues[key]),
  };

  const prismaMock = {
    $queryRaw: jest.fn(),
  };

  const loggerMock = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const onchainAdapterMock = {
    getContractMetadata: jest.fn().mockResolvedValue({
      version: '1.0.0',
      name: 'Soroban AidEscrow Contract',
      timestamp: new Date(),
    }),
  };

  const redisClientMock = {
    ping: jest.fn(),
  };

  const originalFetch = global.fetch;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        MetadataService,
        { provide: ConfigService, useValue: configMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: LoggerService, useValue: loggerMock },
        { provide: ONCHAIN_ADAPTER_TOKEN, useValue: onchainAdapterMock },
        { provide: REDIS_CLIENT, useValue: redisClientMock },
        {
          provide: ProviderHealthRegistryService,
          useValue: {
            getAllStatuses: jest.fn().mockReturnValue({}),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    healthService = moduleRef.get(HealthService);
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Readiness caching is intentionally instance state; reset it between
    // tests so one test's cached result can't leak into the next.
    (healthService as unknown as { readinessCache: unknown }).readinessCache =
      null;
    configValues.STELLAR_RPC_URL = undefined;
    configValues.HEALTHCHECK_STELLAR_REQUIRED = undefined;
    configValues.HEALTHCHECK_STELLAR_TIMEOUT_MS = undefined;
    configValues.HEALTHCHECK_REDIS_REQUIRED = undefined;
    configValues.HEALTHCHECK_AI_REQUIRED = undefined;
    configValues.HEALTHCHECK_CACHE_TTL_MS = '0';
    configValues.AI_SERVICE_URL = undefined;
    configValues.GIT_SHA = undefined;
    configValues.BUILD_TIMESTAMP = undefined;
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redisClientMock.ping.mockResolvedValue('PONG');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await app.close();
  });

  it('GET /health/live returns process liveness', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        service: 'backend',
        checks: {
          process: expect.objectContaining({
            status: 'up',
          }),
        },
      }),
    );
  });

  it('GET /health/live includes deployment metadata with safe defaults when unset', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);

    expect(res.body.deployment).toEqual({
      gitSha: 'unknown',
      environment: 'test',
      buildTimestamp: 'unknown',
    });
  });

  it('GET /health/live surfaces deployment metadata when GIT_SHA/BUILD_TIMESTAMP are set', async () => {
    configValues.GIT_SHA = 'a1b2c3d';
    configValues.BUILD_TIMESTAMP = '2025-02-23T10:00:00.000Z';

    const res = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);

    expect(res.body.deployment).toEqual({
      gitSha: 'a1b2c3d',
      environment: 'test',
      buildTimestamp: '2025-02-23T10:00:00.000Z',
    });
  });

  it('GET /health/ready returns ready when all dependencies are reachable and Stellar is optional', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ready',
        ready: true,
        checks: {
          database: expect.objectContaining({
            status: 'up',
            latencyMs: expect.any(Number),
          }),
          redis: expect.objectContaining({
            status: 'up',
            latencyMs: expect.any(Number),
          }),
          aiService: expect.objectContaining({
            status: 'up',
            latencyMs: expect.any(Number),
          }),
          stellarRpc: expect.objectContaining({
            status: 'skipped',
            latencyMs: 0,
          }),
        },
      }),
    );
  });

  it('GET /health/ready returns 503 when database is not reachable', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'not_ready',
        ready: false,
        checks: expect.objectContaining({
          database: expect.objectContaining({ status: 'down' }),
        }),
      }),
    );
  });

  it('GET /health/ready returns 503 when Stellar is required and RPC is down', async () => {
    configValues.STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
    configValues.HEALTHCHECK_STELLAR_REQUIRED = 'true';
    global.fetch = jest.fn((url: string) => {
      if (url.includes('soroban-testnet.stellar.org')) {
        return Promise.reject(new Error('rpc timeout'));
      }
      return Promise.resolve({ ok: true, status: 200 });
    });

    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'not_ready',
        ready: false,
        checks: expect.objectContaining({
          database: expect.objectContaining({ status: 'up' }),
          stellarRpc: expect.objectContaining({ status: 'down' }),
        }),
      }),
    );
  });

  it('GET /health/ready reports degraded (200) when a non-critical dependency is down', async () => {
    redisClientMock.ping.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'degraded',
        ready: true,
        checks: expect.objectContaining({
          database: expect.objectContaining({ status: 'up' }),
          redis: expect.objectContaining({ status: 'down' }),
        }),
      }),
    );
  });

  it('GET /health/ready returns 503 when Redis is required and down', async () => {
    configValues.HEALTHCHECK_REDIS_REQUIRED = 'true';
    redisClientMock.ping.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'not_ready',
        ready: false,
        checks: expect.objectContaining({
          redis: expect.objectContaining({ status: 'down' }),
        }),
      }),
    );
  });

  it('GET /health/ready returns 503 when the AI service is required and down', async () => {
    configValues.HEALTHCHECK_AI_REQUIRED = 'true';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'not_ready',
        ready: false,
        checks: expect.objectContaining({
          aiService: expect.objectContaining({ status: 'down' }),
        }),
      }),
    );
  });

  it('GET /health/ready caches results within the configured TTL', async () => {
    configValues.HEALTHCHECK_CACHE_TTL_MS = '60000';

    const first = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    prismaMock.$queryRaw.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    const second = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(second.body).toEqual(first.body);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('GET /health/metadata returns safe service metadata', async () => {
    configValues.ONCHAIN_ADAPTER = 'mock';
    configValues.SOROBAN_NETWORK = 'testnet';

    const res = await request(app.getHttpServer())
      .get('/health/metadata')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        service: 'soter-backend',
        environment: 'test',
        providers: expect.objectContaining({
          onchain: expect.objectContaining({
            adapter: 'mock',
            network: 'testnet',
          }),
          ai: expect.objectContaining({
            active: expect.any(String),
            models: expect.objectContaining({
              openai: expect.any(String),
              groq: expect.any(String),
            }),
          }),
        }),
        capabilities: expect.objectContaining({
          caching: expect.any(Boolean),
          rateLimiting: expect.any(Boolean),
          verification: expect.any(Boolean),
          onchainEscrow: expect.any(Boolean),
          deterministicMode: expect.any(Boolean),
          redisEnabled: expect.any(Boolean),
        }),
      }),
    );
  });

  it('GET /health/metadata never exposes secrets', async () => {
    configValues.OPENAI_API_KEY = 'sk-secret-key';
    configValues.SOROBAN_SECRET_KEY = 'SABCSECRET';

    const res = await request(app.getHttpServer())
      .get('/health/metadata')
      .expect(200);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('sk-secret-key');
    expect(serialized).not.toContain('SABCSECRET');
  });
});

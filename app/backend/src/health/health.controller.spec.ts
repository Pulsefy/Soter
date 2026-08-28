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
import { ProviderHealthRegistryService } from './provider-health-registry.service';

describe('HealthController', () => {
  let app: INestApplication;

  const configValues: Record<string, string | undefined> = {
    NODE_ENV: 'test',
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
        {
          provide: ProviderHealthRegistryService,
          useValue: {
            getAllStatuses: jest.fn().mockReturnValue({}),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    configValues.STELLAR_RPC_URL = undefined;
    configValues.HEALTHCHECK_STELLAR_REQUIRED = undefined;
    configValues.HEALTHCHECK_STELLAR_TIMEOUT_MS = undefined;
    configValues.GIT_SHA = undefined;
    configValues.BUILD_TIMESTAMP = undefined;
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
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

  it('GET /health/ready returns ready when database is reachable and Stellar is optional', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ready',
        ready: true,
        checks: {
          database: expect.objectContaining({ status: 'up' }),
          stellarRpc: expect.objectContaining({ status: 'skipped' }),
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
        checks: {
          database: expect.objectContaining({ status: 'down' }),
          stellarRpc: expect.objectContaining({ status: 'skipped' }),
        },
      }),
    );
  });

  it('GET /health/ready returns 503 when Stellar is required and RPC is down', async () => {
    configValues.STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
    configValues.HEALTHCHECK_STELLAR_REQUIRED = 'true';
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('rpc timeout'));

    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'not_ready',
        ready: false,
        checks: {
          database: expect.objectContaining({ status: 'up' }),
          stellarRpc: expect.objectContaining({ status: 'down' }),
        },
      }),
    );
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

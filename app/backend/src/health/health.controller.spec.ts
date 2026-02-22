import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';

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

  const originalFetch = global.fetch;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: ConfigService, useValue: configMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: LoggerService, useValue: loggerMock },
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
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('database unavailable'));

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
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('rpc timeout')) as unknown as typeof fetch;

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
});

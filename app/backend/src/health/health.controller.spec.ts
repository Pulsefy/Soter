import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';
import {
  ONCHAIN_ADAPTER_TOKEN,
  OnchainAdapter,
} from '../onchain/onchain.adapter';

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
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('rpc timeout'),
      ) as unknown as typeof fetch;

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

describe('HealthController - Onchain Probe', () => {
  let app: INestApplication;

  const configValues: Record<string, string | undefined> = {
    NODE_ENV: 'test',
  };

  const configMock = {
    get: jest.fn((key: string) => configValues[key]),
  };

  const loggerMock = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const onchainAdapterMock: jest.Mocked<OnchainAdapter> = {
    getAidPackageCount: jest.fn(),
    getAidPackage: jest.fn(),
    getTokenBalance: jest.fn(),
    createAidPackage: jest.fn(),
    batchCreateAidPackages: jest.fn(),
    claimAidPackage: jest.fn(),
    disburseAidPackage: jest.fn(),
    initEscrow: jest.fn(),
    createClaim: jest.fn(),
    disburse: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: ConfigService, useValue: configMock },
        { provide: ONCHAIN_ADAPTER_TOKEN, useValue: onchainAdapterMock },
        { provide: LoggerService, useValue: loggerMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    configValues.SOROBAN_CONTRACT_ID = undefined;
    configValues.STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
    configValues.HEALTHCHECK_ONCHAIN_TIMEOUT_MS = undefined;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/onchain-probe returns ok when contract call succeeds', async () => {
    configValues.SOROBAN_CONTRACT_ID =
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    onchainAdapterMock.getAidPackageCount.mockResolvedValueOnce({
      aggregates: {
        totalCommitted: '1000000',
        totalClaimed: '500000',
        totalExpiredCancelled: '100000',
      },
      timestamp: new Date(),
    });

    const res = await request(app.getHttpServer())
      .get('/health/onchain-probe')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        timestamp: expect.any(String),
        latencyMs: expect.any(Number),
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        rpcUrl: 'https://soroban-testnet.stellar.org',
      }),
    );
    expect(onchainAdapterMock.getAidPackageCount).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
      }),
    );
  });

  it('GET /health/onchain-probe returns ok when contract ID not configured', async () => {
    configValues.SOROBAN_CONTRACT_ID = undefined;

    const res = await request(app.getHttpServer())
      .get('/health/onchain-probe')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        timestamp: expect.any(String),
        latencyMs: expect.any(Number),
        contractId: undefined,
        rpcUrl: 'https://soroban-testnet.stellar.org',
      }),
    );
  });

  it('GET /health/onchain-probe returns error when contract call fails', async () => {
    configValues.SOROBAN_CONTRACT_ID =
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    onchainAdapterMock.getAidPackageCount.mockRejectedValueOnce(
      new Error('RPC connection refused'),
    );

    const res = await request(app.getHttpServer())
      .get('/health/onchain-probe')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'error',
        timestamp: expect.any(String),
        latencyMs: expect.any(Number),
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        rpcUrl: 'https://soroban-testnet.stellar.org',
      }),
    );
  });

  it('GET /health/onchain-probe returns error on timeout', async () => {
    configValues.SOROBAN_CONTRACT_ID =
      'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    configValues.HEALTHCHECK_ONCHAIN_TIMEOUT_MS = '100'; // Very short timeout

    onchainAdapterMock.getAidPackageCount.mockImplementation(
      () =>
        new Promise(resolve =>
          // Never resolves, so it will timeout
          setTimeout(() => {
            resolve({
              aggregates: {
                totalCommitted: '1000000',
                totalClaimed: '500000',
                totalExpiredCancelled: '100000',
              },
              timestamp: new Date(),
            });
          }, 5000),
        ),
    );

    const res = await request(app.getHttpServer())
      .get('/health/onchain-probe')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'error',
        timestamp: expect.any(String),
        latencyMs: expect.any(Number),
      }),
    );
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(100);
  });
});

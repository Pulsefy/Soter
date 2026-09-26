import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';
import { ONCHAIN_ADAPTER_TOKEN } from '../onchain/onchain.adapter';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ProviderHealthRegistryService } from './provider-health-registry.service';

describe('HealthService Diagnostics Export', () => {
  let service: HealthService;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'NODE_ENV') return 'test';
              if (key === 'STELLAR_RPC_URL')
                return 'https://soroban-testnet.stellar.org';
              if (key === 'HEALTHCHECK_CACHE_TTL_MS') return '0';
              return null;
            }),
          },
        },
        {
          provide: LoggerService,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: { $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]) },
        },
        {
          provide: ONCHAIN_ADAPTER_TOKEN,
          useValue: { getContractMetadata: jest.fn() },
        },
        {
          provide: REDIS_CLIENT,
          useValue: { ping: jest.fn().mockResolvedValue('PONG') },
        },
        {
          provide: ProviderHealthRegistryService,
          useValue: {
            getAllStatuses: jest.fn().mockReturnValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should generate a sanitized diagnostics export bundle', async () => {
    const result = await service.getDiagnosticsExport();
    expect(result).toHaveProperty('metadata');
    expect(result.metadata.service).toBe('soter-backend');
    expect(result.sanitized).toBe(true);
    expect(result.appState.database.status).toBe('up');
  });
});

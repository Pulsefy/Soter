import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MetadataService } from './metadata.service';

describe('MetadataService', () => {
  let service: MetadataService;

  const configValues: Record<string, string | undefined> = {};

  const configMock = {
    get: jest.fn((key: string) => configValues[key]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.keys(configValues).forEach((key) => delete configValues[key]);

    configValues.NODE_ENV = 'test';
    configValues.ONCHAIN_ADAPTER = 'mock';
    configValues.SOROBAN_NETWORK = 'testnet';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetadataService,
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    service = module.get<MetadataService>(MetadataService);
  });

  it('should return expected structure with safe defaults', () => {
    const result = service.getMetadata();

    expect(result).toEqual({
      service: 'soter-backend',
      version: expect.any(String),
      environment: 'test',
      timestamp: expect.any(String),
      providers: {
        onchain: { adapter: 'mock', network: 'testnet' },
        ai: {
          active: 'none',
          models: { openai: 'gpt-4o-mini', groq: 'llama-3.3-70b-versatile' },
        },
      },
      capabilities: {
        caching: false,
        rateLimiting: true,
        verification: false,
        onchainEscrow: false,
        deterministicMode: false,
        redisEnabled: false,
      },
    });
  });

  it('should reflect configured onchain adapter and network', () => {
    configValues.ONCHAIN_ADAPTER = 'soroban';
    configValues.SOROBAN_NETWORK = 'mainnet';

    const result = service.getMetadata();

    expect(result.providers.onchain.adapter).toBe('soroban');
    expect(result.providers.onchain.network).toBe('mainnet');
  });

  it('should detect openai provider when key is set', () => {
    configValues.OPENAI_API_KEY = 'sk-test-key';

    const result = service.getMetadata();

    expect(result.providers.ai.active).toBe('openai');
  });

  it('should detect groq provider when openai key is absent', () => {
    configValues.GROQ_API_KEY = 'gsk-test-key';

    const result = service.getMetadata();

    expect(result.providers.ai.active).toBe('groq');
  });

  it('should detect test provider mode', () => {
    configValues.TEST_PROVIDER_MODE = 'true';

    const result = service.getMetadata();

    expect(result.providers.ai.active).toBe('test');
  });

  it('should reflect custom AI model names', () => {
    configValues.OPENAI_MODEL = 'gpt-4o';
    configValues.GROQ_MODEL = 'llama-3.1-8b';

    const result = service.getMetadata();

    expect(result.providers.ai.models.openai).toBe('gpt-4o');
    expect(result.providers.ai.models.groq).toBe('llama-3.1-8b');
  });

  it('should reflect capability flags when config is present', () => {
    configValues.CACHE_TTL_VERIFICATION_STATUS = '300';
    configValues.VERIFICATION_MODE = 'mock';
    configValues.AID_ESCROW_CONTRACT_ID = 'CABC123';
    configValues.AI_DETERMINISTIC_MODE = 'true';
    configValues.REDIS_HOST = 'localhost';

    const result = service.getMetadata();

    expect(result.capabilities.caching).toBe(true);
    expect(result.capabilities.verification).toBe(true);
    expect(result.capabilities.onchainEscrow).toBe(true);
    expect(result.capabilities.deterministicMode).toBe(true);
    expect(result.capabilities.redisEnabled).toBe(true);
  });

  it('should never expose secrets in output', () => {
    configValues.OPENAI_API_KEY = 'sk-secret-value';
    configValues.GROQ_API_KEY = 'gsk-secret-value';
    configValues.SOROBAN_SECRET_KEY = 'SABCSECRET';
    configValues.AI_WEBHOOK_SECRET = 'webhook-secret';
    configValues.DATABASE_PASSWORD = 'db-pass';

    const result = service.getMetadata();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('sk-secret-value');
    expect(serialized).not.toContain('gsk-secret-value');
    expect(serialized).not.toContain('SABCSECRET');
    expect(serialized).not.toContain('webhook-secret');
    expect(serialized).not.toContain('db-pass');
  });

  it('should return valid ISO timestamp', () => {
    const result = service.getMetadata();
    const parsed = new Date(result.timestamp);

    expect(parsed.toISOString()).toBe(result.timestamp);
  });
});

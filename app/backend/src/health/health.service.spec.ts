import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';
import { LoggerService } from '../logger/logger.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthService dependency probe', () => {
  let service: HealthService;
  const configValues: Record<string, string | undefined> = {
    VERIFICATION_MODE: 'mock',
    AI_SERVICE_URL: 'http://localhost:8000',
    OPENAI_API_KEY: undefined,
  };

  const configMock = {
    get: jest.fn((key: string) => configValues[key]),
  };

  const loggerMock = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const prismaMock = {} as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HealthService(
      configMock as unknown as ConfigService,
      loggerMock as unknown as LoggerService,
      prismaMock,
    );
  });

  it('marks provider configuration ready for mock verification mode', async () => {
    configValues.VERIFICATION_MODE = 'mock';
    configValues.AI_SERVICE_URL = undefined;
    configValues.OPENAI_API_KEY = undefined;

    const result = await (service as any).checkProviderConfiguration();

    expect(result.status).toBe('up');
    expect(result.details).toEqual(
      expect.objectContaining({
        verificationMode: 'mock',
        aiServiceUrlConfigured: false,
        openAIKeyConfigured: false,
        required: false,
      }),
    );
  });

  it('marks provider configuration not ready when AI mode is enabled and required config is missing', async () => {
    configValues.VERIFICATION_MODE = 'ai';
    configValues.AI_SERVICE_URL = 'http://localhost:8000';
    configValues.OPENAI_API_KEY = undefined;

    const result = await (service as any).checkProviderConfiguration();

    expect(result.status).toBe('down');
    expect(result.details).toEqual(
      expect.objectContaining({
        verificationMode: 'ai',
        aiServiceUrlConfigured: true,
        openAIKeyConfigured: false,
        required: true,
      }),
    );
  });

  it('returns a ready dependency probe result when all checks pass', async () => {
    configValues.VERIFICATION_MODE = 'mock';
    configValues.AI_SERVICE_URL = undefined;
    configValues.OPENAI_API_KEY = undefined;

    jest
      .spyOn(service as any, 'checkRedisConnectivity')
      .mockResolvedValue({ status: 'up' });
    jest
      .spyOn(service as any, 'checkFilesystemAccess')
      .mockResolvedValue({ status: 'up' });

    const probe = await service.getDependencyProbe();

    expect(probe.ready).toBe(true);
    expect(probe.status).toBe('ready');
    expect(probe.checks.redis.status).toBe('up');
    expect(probe.checks.filesystem.status).toBe('up');
    expect(probe.checks.providerConfiguration.status).toBe('up');
  });
});

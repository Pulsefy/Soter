import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  OnchainModule,
  ONCHAIN_ADAPTER_TOKEN,
  createOnchainAdapter,
} from './onchain.module';
import { OnchainAdapter } from './onchain.adapter';
import { MockOnchainAdapter } from './onchain.adapter.mock';
import { SorobanAdapter } from './soroban.adapter';
import { PrismaModule } from '../prisma/prisma.module';

describe('OnchainModule', () => {
  let module: TestingModule;
  let _configService: ConfigService;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: false,
        }),
        PrismaModule,
        OnchainModule,
      ],
    }).compile();

    _configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should provide OnchainAdapter token', () => {
    const adapter = module.get<OnchainAdapter>(ONCHAIN_ADAPTER_TOKEN);
    expect(adapter).toBeDefined();
  });

  it('should provide MockOnchainAdapter by default', () => {
    const adapter = module.get<OnchainAdapter>(ONCHAIN_ADAPTER_TOKEN);
    expect(adapter).toBeInstanceOf(MockOnchainAdapter);
  });
});

describe('createOnchainAdapter', () => {
  let configService: ConfigService;

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as unknown as ConfigService;
  });

  it('should create MockOnchainAdapter when ONCHAIN_ADAPTER is mock', () => {
    jest.spyOn(configService, 'get').mockReturnValue('mock');

    const adapter = createOnchainAdapter(configService);

    expect(adapter).toBeInstanceOf(MockOnchainAdapter);
  });

  it('should create MockOnchainAdapter when ONCHAIN_ADAPTER is not set', () => {
    jest.spyOn(configService, 'get').mockReturnValue(undefined);

    const adapter = createOnchainAdapter(configService);

    expect(adapter).toBeInstanceOf(MockOnchainAdapter);
  });

  it('should create MockOnchainAdapter when ONCHAIN_ADAPTER is Mock (case insensitive)', () => {
    jest.spyOn(configService, 'get').mockReturnValue('Mock');

    const adapter = createOnchainAdapter(configService);

    expect(adapter).toBeInstanceOf(MockOnchainAdapter);
  });

  it('should create SorobanAdapter when ONCHAIN_ADAPTER is soroban', () => {
    jest.spyOn(configService, 'get').mockReturnValue('soroban');

    const adapter = createOnchainAdapter(configService);

    expect(adapter).toBeInstanceOf(SorobanAdapter);
  });

  it('should throw error when ONCHAIN_ADAPTER is unknown', () => {
    jest.spyOn(configService, 'get').mockReturnValue('unknown');

    expect(() => createOnchainAdapter(configService)).toThrow(
      'Unknown ONCHAIN_ADAPTER: unknown. Supported values: mock, soroban',
    );
  });
});

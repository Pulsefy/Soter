import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyExpiryProcessor } from './api-key-expiry.processor';
import { ApiKeysService } from './api-keys.service';

describe('ApiKeyExpiryProcessor', () => {
  it('delegates to ApiKeysService.surfaceUpcomingExpirations', async () => {
    const apiKeys = {
      surfaceUpcomingExpirations: jest
        .fn()
        .mockResolvedValue([{ id: 'k1' }, { id: 'k2' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyExpiryProcessor,
        { provide: ApiKeysService, useValue: apiKeys },
      ],
    }).compile();

    const processor = module.get(ApiKeyExpiryProcessor);
    const result = await processor.process({ id: 'job-1' } as any);

    expect(apiKeys.surfaceUpcomingExpirations).toHaveBeenCalled();
    expect(result).toEqual({ reminded: 2 });
  });
});

import { RedisService } from './redis.service';

describe('RedisService - SCAN-based key counting', () => {
  let service: RedisService;
  let mockClient: {
    scan: jest.Mock;
    del: jest.Mock;
    on: jest.Mock;
  };

  beforeEach(() => {
    service = new RedisService();
    mockClient = {
      scan: jest.fn(),
      del: jest.fn(),
      on: jest.fn(),
    };
    // Inject the mocked ioredis client directly, bypassing onModuleInit's
    // real connection so these tests run under controlled conditions.
    (service as unknown as { client: typeof mockClient }).client = mockClient;
  });

  describe('countKeysByPattern', () => {
    it('counts keys matching a pattern across a single SCAN page without deleting them', async () => {
      mockClient.scan.mockResolvedValueOnce([
        '0',
        ['cache:response:a', 'cache:response:b'],
      ]);

      const count = await service.countKeysByPattern('cache:response:*');

      expect(count).toBe(2);
      expect(mockClient.del).not.toHaveBeenCalled();
      expect(mockClient.scan).toHaveBeenCalledWith(
        '0',
        'MATCH',
        'cache:response:*',
        'COUNT',
        100,
      );
    });

    it('follows the cursor across multiple SCAN pages until exhausted', async () => {
      mockClient.scan
        .mockResolvedValueOnce(['17', ['key:1', 'key:2']])
        .mockResolvedValueOnce(['0', ['key:3']]);

      const count = await service.countKeysByPattern('key:*');

      expect(count).toBe(3);
      expect(mockClient.scan).toHaveBeenCalledTimes(2);
    });

    it('returns 0 and does not throw when Redis errors out', async () => {
      mockClient.scan.mockRejectedValue(new Error('connection lost'));

      const count = await service.countKeysByPattern('cache:response:*');

      expect(count).toBe(0);
    });

    it('returns 0 for a pattern with no matching keys', async () => {
      mockClient.scan.mockResolvedValueOnce(['0', []]);

      const count = await service.countKeysByPattern(
        'cache:response:*nomatch*',
      );

      expect(count).toBe(0);
    });
  });

  describe('delByPattern', () => {
    it('deletes exactly the keys discovered by SCAN and reports the count', async () => {
      mockClient.scan.mockResolvedValueOnce(['0', ['a', 'b', 'c']]);
      mockClient.del.mockResolvedValue(3);

      const deleted = await service.delByPattern('cache:response:*');

      expect(deleted).toBe(3);
      expect(mockClient.del).toHaveBeenCalledWith('a', 'b', 'c');
    });

    it('skips the DEL call entirely when no keys match', async () => {
      mockClient.scan.mockResolvedValueOnce(['0', []]);

      const deleted = await service.delByPattern('cache:response:*nomatch*');

      expect(deleted).toBe(0);
      expect(mockClient.del).not.toHaveBeenCalled();
    });
  });
});

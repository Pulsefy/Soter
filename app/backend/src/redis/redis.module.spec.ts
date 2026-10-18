jest.mock('ioredis', () => {
  const RedisMock = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
  }));

  return {
    __esModule: true,
    default: RedisMock,
  };
});

import { createRedisClient } from './redis.module';

describe('createRedisClient', () => {
  afterEach(() => {
    delete process.env.SKIP_BACKGROUND_JOBS;
    jest.clearAllMocks();
  });

  it('returns a no-op client when background jobs are skipped', async () => {
    process.env.SKIP_BACKGROUND_JOBS = 'true';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RedisMock = require('ioredis').default as jest.Mock;
    const client = createRedisClient({
      get: jest.fn(),
    });

    expect(RedisMock).not.toHaveBeenCalled();
    await expect(client.incr('spec:test')).resolves.toBe(1);
    await expect(client.expire('spec:test', 60)).resolves.toBe(true);
    await expect(client.ttl('spec:test')).resolves.toBe(1);
  });
});

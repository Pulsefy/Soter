import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export function isBackgroundJobsSkipped(): boolean {
  return process.env.SKIP_BACKGROUND_JOBS === 'true';
}

export function createRedisClient(
  configService: Pick<ConfigService, 'get'>,
): Redis {
  if (isBackgroundJobsSkipped()) {
    return new Proxy({} as Redis, {
      get(_target, prop) {
        if (prop === 'on') return () => undefined;
        if (prop === 'connect') return async () => undefined;
        if (prop === 'disconnect' || prop === 'quit') return async () => undefined;
        if (prop === 'status') return 'ready';
        if (prop === 'ready') return true;
        if (prop === 'ping') return async () => 'PONG';
        if (prop === 'incr') return async () => 1;
        if (prop === 'expire') return async () => true;
        if (prop === 'ttl') return async () => 1;
        return async () => undefined;
      },
    });
  }

  const client = new Redis({
    host: configService.get<string>('REDIS_HOST') ?? 'localhost',
    port: parseInt(configService.get<string>('REDIS_PORT') ?? '6379', 10),
  });
  // ioredis emits 'error' on connection failure. Without a listener the
  // process exits, which is how spec:check died in CI with no Redis.
  client.on('error', () => undefined);
  return client;
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) =>
        createRedisClient(configService),
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}

import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService) => {
        const client = new Redis({
          host: configService.get<string>('REDIS_HOST') ?? 'localhost',
          port: parseInt(configService.get<string>('REDIS_PORT') ?? '6379', 10),
        });
        // ioredis emits 'error' on connection failure. Without a listener the
        // process exits, which is how spec:check died in CI with no Redis.
        client.on('error', () => undefined);
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}

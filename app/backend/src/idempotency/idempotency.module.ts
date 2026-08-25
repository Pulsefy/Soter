import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { IdempotencyStore } from './store';
import { IdempotencyExpiryProcessor } from './idempotency-expiry.processor';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [
    {
      provide: IdempotencyStore,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const connectionString =
          configService.get<string>('DATABASE_URL') ??
          configService.get<string>('POSTGRES_URL');
        const pool = new Pool({ connectionString });
        const retentionHours = parseInt(
          configService.get<string>('IDEMPOTENCY_RETENTION_HOURS') ?? '720',
          10,
        );
        return new IdempotencyStore(pool, retentionHours * 60 * 60 * 1000);
      },
    },
    IdempotencyExpiryProcessor,
  ],
  exports: [IdempotencyStore],
})
export class IdempotencyModule {}
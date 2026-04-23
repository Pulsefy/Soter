import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JobsController } from './jobs.controller';
import { DeadLetterProcessor } from './dead-letter.processor';
import { DeadLetterService } from './dead-letter.service';

/**
 * JobsModule
 *
 * Owns:
 *  - The monitoring controller (`GET /jobs/status`, `GET /jobs/health`,
 *    `GET /jobs/dead-letter`, `POST /jobs/dead-letter/:id/requeue`)
 *  - The Dead Letter Queue (DLQ) registration, processor, and service
 *
 * The three domain queues (verification, notifications, onchain) are
 * registered here as *references* only (no connection config) so the
 * controller can inject them for read-only metrics without duplicating
 * the Redis connection setup that lives in each domain module.
 */
@Module({
  imports: [
    ConfigModule,
    // Reference-only registrations for the three domain queues
    BullModule.registerQueue({ name: 'verification' }),
    BullModule.registerQueue({ name: 'notifications' }),
    BullModule.registerQueue({ name: 'onchain' }),

    // Dead Letter Queue – full async registration with connection + policies
    BullModule.registerQueueAsync({
      name: 'dead-letter',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') ?? 'localhost',
          port: parseInt(
            configService.get<string>('REDIS_PORT') ?? '6379',
            10,
          ),
        },
        defaultJobOptions: {
          removeOnComplete: 500, // keep last 500 processed DLQ records
          removeOnFail: false,   // never auto-remove failed DLQ records
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [JobsController],
  providers: [DeadLetterProcessor, DeadLetterService],
  exports: [DeadLetterService],
})
export class JobsModule {}

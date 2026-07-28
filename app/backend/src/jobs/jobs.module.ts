import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsController } from './jobs.controller';
import { RETENTION_PURGE_QUEUE } from '../retention-policy/retention-purge.processor';
import { DlqService } from './dlq.service';

const isRedisEnabled = process.env.REDIS_ENABLED === 'true';

@Module({
  imports: [
    ...(isRedisEnabled
      ? [
          BullModule.registerQueue(
            { name: 'verification' },
            { name: 'notifications' },
            { name: 'onchain' },
            { name: RETENTION_PURGE_QUEUE },
            { name: 'dead-letter' },
          ),
        ]
      : []),
  ],
  controllers: [JobsController],
  providers: [DlqService],
  exports: [DlqService],
})
export class JobsModule {}

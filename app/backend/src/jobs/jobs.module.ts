import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { RedisModule } from '../redis/redis.module';
import { JobsController } from './jobs.controller';
import { JobStatusStreamingController } from './controllers/job-status-streaming.controller';
import { RETENTION_PURGE_QUEUE } from '../retention-policy/retention-purge.processor';
import { DlqService } from './dlq.service';
import { JobStatusBroadcaster } from './services/job-status-broadcaster.service';
import { JobStatusTracker } from './services/job-status-tracker.service';
import { JobStatusGateway } from './gateways/job-status.gateway';

const skipBackgroundJobs = process.env.SKIP_BACKGROUND_JOBS === 'true';

@Module({
  imports: [
    RedisModule,
    ...(skipBackgroundJobs
      ? []
      : [
          BullModule.registerQueue({ name: 'verification' }),
          BullModule.registerQueue({ name: 'notifications' }),
          BullModule.registerQueue({ name: 'onchain' }),
          BullModule.registerQueue({ name: RETENTION_PURGE_QUEUE }),
          BullModule.registerQueue({ name: 'dead-letter' }),
        ]),
    EventEmitterModule.forRoot(),
  ],
  controllers: [JobsController, JobStatusStreamingController],
  providers: [
    DlqService,
    JobStatusBroadcaster,
    JobStatusTracker,
    JobStatusGateway,
  ],
  exports: [
    DlqService,
    JobStatusBroadcaster,
    JobStatusTracker,
    JobStatusGateway,
  ],
})
export class JobsModule {}

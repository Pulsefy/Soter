import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsController } from './jobs.controller';
import { RETENTION_PURGE_QUEUE } from '../retention-policy/retention-purge.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'verification' }),
    BullModule.registerQueue({ name: 'notifications' }),
    BullModule.registerQueue({ name: 'onchain' }),
    BullModule.registerQueue({ name: RETENTION_PURGE_QUEUE }),
  ],
  controllers: [JobsController],
})
export class JobsModule {}

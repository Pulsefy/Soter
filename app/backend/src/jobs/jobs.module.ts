import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsController } from './jobs.controller';
import { JobsMonitorService } from './jobs-monitor.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'verification' }),
    BullModule.registerQueue({ name: 'notifications' }),
    BullModule.registerQueue({ name: 'onchain' }),
  ],
  controllers: [JobsController],
  providers: [JobsMonitorService],
  exports: [JobsMonitorService],
})
export class JobsModule {}

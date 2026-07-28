import { Module, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { InvitesController } from './invites.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { InvitesProcessor, INVITE_EXPIRY_QUEUE } from './invites.processor';
import { Queue } from 'bullmq';

const isRedisEnabled = process.env.REDIS_ENABLED === 'true';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    ...(isRedisEnabled
      ? [BullModule.registerQueue({ name: INVITE_EXPIRY_QUEUE })]
      : []),
  ],
  providers: [InvitesService, InvitesProcessor],
  controllers: [InvitesController],
  exports: [InvitesService],
})
export class InvitesModule implements OnModuleInit {
  private readonly logger = new Logger(InvitesModule.name);
  constructor(
    @Optional()
    @InjectQueue(INVITE_EXPIRY_QUEUE)
    private readonly inviteExpiryQueue?: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!isRedisEnabled) {
      this.logger.warn(
        'Redis disabled — invite expiry cron will not be scheduled via BullMQ.',
      );
      return;
    }
    try {
      if (!this.inviteExpiryQueue) return;
      await this.inviteExpiryQueue.add(
        'check-expiry',
        {},
        {
          repeat: { pattern: '0 * * * *' },
          removeOnComplete: true,
        },
      );
    } catch (err) {
      this.logger.warn(
        `Failed to schedule invite expiry job: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

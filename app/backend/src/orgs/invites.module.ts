import { Module, OnModuleInit } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { InvitesController } from './invites.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { InvitesProcessor, INVITE_EXPIRY_QUEUE } from './invites.processor';
import { Queue } from 'bullmq';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    BullModule.registerQueue({ name: INVITE_EXPIRY_QUEUE }),
  ],
  providers: [InvitesService, InvitesProcessor],
  controllers: [InvitesController],
  exports: [InvitesService],
})
export class InvitesModule implements OnModuleInit {
  constructor(
    @InjectQueue(INVITE_EXPIRY_QUEUE) private readonly inviteExpiryQueue: Queue,
  ) {}

  async onModuleInit() {
    // Schedule invite expiry check every hour
    await this.inviteExpiryQueue.add(
      'check-expiry',
      {},
      {
        repeat: { pattern: '0 * * * *' }, // Every hour at minute 0
        removeOnComplete: true,
      },
    );
  }
}

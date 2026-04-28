import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { InviteStatus } from '@prisma/client';

export const INVITE_EXPIRY_QUEUE = 'invite-expiry';

@Processor(INVITE_EXPIRY_QUEUE)
export class InvitesProcessor extends WorkerHost {
  private readonly logger = new Logger(InvitesProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`Processing invite expiry check (Job: ${job.id})`);

    const result = await this.prisma.invite.updateMany({
      where: {
        status: InviteStatus.pending,
        expiresAt: { lt: new Date() },
      },
      data: {
        status: InviteStatus.expired,
      },
    });

    if (result.count > 0) {
      this.logger.log(
        `Invite expiry check completed. Expired ${result.count} invites.`,
      );
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ClaimStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

/**
 * Service to handle background retry logic for stuck or failed claim disbursements
 */
@Injectable()
export class ClaimRetryService {
  private readonly logger = new Logger(ClaimRetryService.name);
  private readonly maxDisbursingDuration: number;
  private readonly maxRetryAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('onchain') private readonly onchainQueue: Queue,
    private readonly configService: ConfigService,
  ) {
    this.maxDisbursingDuration = 
      this.configService.get<number>('CLAIM_MAX_DISBURSING_DURATION', 30 * 60 * 1000);
    this.maxRetryAttempts = 
      this.configService.get<number>('CLAIM_MAX_RETRY_ATTEMPTS', 5);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleStuckDisbursements(): Promise<void> {
    try {
      this.logger.log('Checking for stuck disbursements...');
      const result = await this.checkAndRetryStuckDisbursements();
      
      if (result.retriedCount > 0) {
        this.logger.log(`Retried ${result.retriedCount} stuck disbursement(s)`);
      }
      
      if (result.revertedCount > 0) {
        this.logger.warn(`Reverted ${result.revertedCount} disbursement(s) to approved status`);
      }
      
      if (result.alertCount > 0) {
        this.logger.error(`Generated ${result.alertCount} alert(s) for failed disbursements`);
      }
    } catch (error) {
      this.logger.error(
        'Failed to check for stuck disbursements',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async checkAndRetryStuckDisbursements(): Promise<{
    retriedCount: number;
    revertedCount: number;
    alertCount: number;
  }> {
    const stuckThreshold = new Date(Date.now() - this.maxDisbursingDuration);
    
    const stuckClaims = await this.prisma.claim.findMany({
      where: {
        status: ClaimStatus.disbursing,
        updatedAt: { lt: stuckThreshold },
        deletedAt: null,
      },
      include: { campaign: true },
    });

    if (stuckClaims.length === 0) {
      return { retriedCount: 0, revertedCount: 0, alertCount: 0 };
    }

    this.logger.log(`Found ${stuckClaims.length} claim(s) stuck in disbursing status`);

    let retriedCount = 0;
    let revertedCount = 0;
    let alertCount = 0;

    for (const claim of stuckClaims) {
      try {
        const jobs = await this.onchainQueue.getJobs(['waiting', 'active', 'delayed'], 0, 100);
        const existingJob = jobs.find(job => 
          job.data.type === 'disburse' && 
          job.data.params.claimId === claim.id
        );

        if (existingJob) {
          if (existingJob.attemptsMade >= this.maxRetryAttempts) {
            await this.revertClaimToApproved(claim.id);
            revertedCount++;
            this.generateAlert(claim, 'max_retries_reached');
            alertCount++;
          }
        } else {
          await this.retryDisbursement(claim);
          retriedCount++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to process stuck claim ${claim.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        this.generateAlert(claim, 'processing_failed');
        alertCount++;
      }
    }

    return { retriedCount, revertedCount, alertCount };
  }

  private async retryDisbursement(claim: any): Promise<void> {
    const packageId = this.generateMockPackageId(claim.id);
    const tokenAddress = this.getTokenAddressForClaim(claim);

    await this.onchainQueue.add(
      'disburse',
      {
        type: 'disburse',
        params: {
          claimId: claim.id,
          packageId,
          recipientAddress: claim.recipientRef,
          amount: claim.amount.toString(),
          tokenAddress,
        },
        timestamp: Date.now(),
      },
      {
        attempts: this.maxRetryAttempts,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log(`Re-enqueued disbursement job for claim ${claim.id}`);
  }

  private async revertClaimToApproved(claimId: string): Promise<void> {
    await this.prisma.claim.update({
      where: { id: claimId },
      data: { status: ClaimStatus.approved },
    });

    this.logger.log(`Reverted claim ${claimId} from disbursing to approved`);
  }

  private generateAlert(claim: any, reason: string): void {
    const alertMessage = {
      claimId: claim.id,
      campaignId: claim.campaignId,
      amount: claim.amount,
      reason,
      timestamp: new Date().toISOString(),
    };

    this.logger.error(`Claim disbursement alert: ${JSON.stringify(alertMessage)}`);
  }

  private generateMockPackageId(claimId: string): string {
    const hash = createHash('sha256')
      .update(`package-${claimId}`)
      .digest('hex');
    return BigInt('0x' + hash.substring(0, 16)).toString();
  }

  private getTokenAddressForClaim(claim: any): string {
    const defaultTokenAddress =
      'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN';

    const claimMetadata = claim.metadata as Record<string, unknown> | undefined;
    if (claimMetadata?.tokenAddress) {
      return claimMetadata.tokenAddress as string;
    }

    const campaignMetadata = claim.campaign?.metadata as
      | Record<string, unknown>
      | undefined;
    if (campaignMetadata?.tokenAddress) {
      return campaignMetadata.tokenAddress as string;
    }

    return defaultTokenAddress;
  }

  async getDisbursementStats(): Promise<{
    disbursing: number;
    stuck: number;
    recentlyFailed: number;
  }> {
    const stuckThreshold = new Date(Date.now() - this.maxDisbursingDuration);
    const recentFailureThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [disbursing, stuck, recentlyFailed] = await Promise.all([
      this.prisma.claim.count({
        where: { status: ClaimStatus.disbursing, deletedAt: null },
      }),
      this.prisma.claim.count({
        where: {
          status: ClaimStatus.disbursing,
          updatedAt: { lt: stuckThreshold },
          deletedAt: null,
        },
      }),
      this.prisma.claim.count({
        where: {
          status: ClaimStatus.approved,
          updatedAt: { gte: recentFailureThreshold },
          deletedAt: null,
        },
      }),
    ]);

    return { disbursing, stuck, recentlyFailed };
  }
}

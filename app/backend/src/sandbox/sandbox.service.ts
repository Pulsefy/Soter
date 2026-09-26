import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';
import { ConfigService } from '@nestjs/config';
import {
  DEMO_TENANT_SEED,
  DEMO_CAMPAIGN_SEEDS,
  DEMO_CLAIM_SEEDS,
} from './demo-seeds.constants';

@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loggerService: LoggerService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resets the demo state by deleting existing demo data and re-seeding it.
   * This operation is restricted to specific environments.
   * @returns A promise that resolves when the demo state has been reset.
   * @throws ForbiddenException if the operation is attempted in a disallowed environment.
   */
  async resetDemoState(): Promise<void> {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const allowedEnvironments = ['development', 'test', 'sandbox'];

    if (!allowedEnvironments.includes(nodeEnv ?? '')) {
      this.loggerService.warn(
        `Attempted demo seed reset in disallowed environment: ${nodeEnv}`,
        SandboxService.name,
      );
      throw new ForbiddenException(
        'Demo seed reset is only allowed in development, test, or sandbox environments.',
      );
    }

    this.loggerService.log('Starting demo seed reset...', SandboxService.name);

    await this.prisma.$transaction(async tx => {
      // 1. Delete Claims associated with demo campaigns
      const demoCampaignNames = DEMO_CAMPAIGN_SEEDS.map(c => c.name);
      const demoCampaigns = await tx.campaign.findMany({
        where: {
          ngoId: DEMO_TENANT_SEED.ngoId,
          name: { in: demoCampaignNames },
        },
        select: { id: true },
      });
      const demoCampaignIds = demoCampaigns.map(c => c.id);

      if (demoCampaignIds.length > 0) {
        await tx.claim.deleteMany({
          where: { campaignId: { in: demoCampaignIds } },
        });
        this.loggerService.log(
          `Deleted ${demoCampaignIds.length} demo claims.`,
          SandboxService.name,
        );
      }

      // 2. Delete Demo Campaigns
      await tx.campaign.deleteMany({
        where: { ngoId: DEMO_TENANT_SEED.ngoId },
      });
      this.loggerService.log(
        `Deleted demo campaigns for NGO: ${DEMO_TENANT_SEED.ngoId}.`,
        SandboxService.name,
      );

      // 3. Delete Demo Tenant
      await tx.organization.deleteMany({
        where: { id: DEMO_TENANT_SEED.ngoId },
      });
      this.loggerService.log(
        `Deleted demo NGO: ${DEMO_TENANT_SEED.ngoId}.`,
        SandboxService.name,
      );

      // 4. Re-seed the demo state
      await this.seedDemoState(tx);
    });

    this.loggerService.log('Demo seed reset completed.', SandboxService.name);
  }

  /**
   * Seeds the database with deterministic demo data.
   * @param tx The Prisma transaction client to use.
   */
  private async seedDemoState(tx: any): Promise<void> {
    this.loggerService.log('Seeding demo tenant...', SandboxService.name);
    const demoNgo = await tx.organization.upsert({
      where: { id: DEMO_TENANT_SEED.ngoId },
      update: {
        name: DEMO_TENANT_SEED.name,
      },
      create: {
        id: DEMO_TENANT_SEED.ngoId,
        name: DEMO_TENANT_SEED.name,
      },
    });
    this.loggerService.log(
      `Seeded demo NGO: ${demoNgo.name}.`,
      SandboxService.name,
    );

    const createdCampaigns = new Map<string, string>(); // Map campaign name to ID

    this.loggerService.log('Seeding demo campaigns...', SandboxService.name);
    for (const campaignSeed of DEMO_CAMPAIGN_SEEDS) {
      const campaign = await tx.campaign.upsert({
        where: {
          ngoId_name: { ngoId: demoNgo.id, name: campaignSeed.name },
        },
        update: {
          status: campaignSeed.status,
          budget: campaignSeed.budget,
          metadata: campaignSeed.metadata,
        },
        create: {
          ngoId: demoNgo.id,
          name: campaignSeed.name,
          status: campaignSeed.status,
          budget: campaignSeed.budget,
          metadata: campaignSeed.metadata,
        },
      });
      createdCampaigns.set(campaign.name, campaign.id);
      this.loggerService.log(
        `Seeded campaign: ${campaign.name}.`,
        SandboxService.name,
      );
    }

    this.loggerService.log('Seeding demo claims...', SandboxService.name);
    for (const claimSeed of DEMO_CLAIM_SEEDS) {
      const campaignId = createdCampaigns.get(claimSeed.campaignName);
      if (campaignId) {
        await tx.claim.upsert({
          where: {
            campaignId_recipientRef: {
              campaignId: campaignId,
              recipientRef: claimSeed.recipientRef,
            },
          },
          update: {
            amount: claimSeed.amount,
            status: claimSeed.status,
            evidenceRef: claimSeed.evidenceRef,
          },
          create: {
            campaignId: campaignId,
            recipientRef: claimSeed.recipientRef,
            amount: claimSeed.amount,
            status: claimSeed.status,
            evidenceRef: claimSeed.evidenceRef,
          },
        });
        this.loggerService.log(
          `Seeded claim for recipient ${claimSeed.recipientRef} in campaign ${claimSeed.campaignName}.`,
          SandboxService.name,
        );
      } else {
        this.loggerService.warn(
          `Campaign "${claimSeed.campaignName}" not found for claim seeding. Skipping claim for recipient ${claimSeed.recipientRef}.`,
          SandboxService.name,
        );
      }
    }
    this.loggerService.log(
      'Demo state seeding completed.',
      SandboxService.name,
    );
  }
}

import {
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEMO_CAMPAIGN_SEEDS,
  DEMO_CLAIM_SEEDS,
  DEMO_TENANT_SEED,
} from './demo-seeds.constants';

/** Return type of {@link SeedService.seedTenant} */
export interface SeedTenantResult {
  ngoId: string;
  created: boolean;
}

/** Return type of {@link SeedService.seedCampaigns} */
export interface SeedCampaignsResult {
  created: number;
  skipped: number;
  campaignIds: string[];
}

/** Return type of {@link SeedService.seedClaims} */
export interface SeedClaimsResult {
  created: number;
  skipped: number;
  claimIds: string[];
}

/** Return type of {@link SeedService.seedAll} */
export interface SeedAllResult {
  tenant: SeedTenantResult;
  campaigns: SeedCampaignsResult;
  claims: SeedClaimsResult;
}

/** Return type of {@link SeedService.resetSeed} */
export interface ResetSeedResult {
  deletedClaims: number;
  deletedCampaigns: number;
  deletedTenants: number;
}

const TENANT_MARKER_NAME = '__demo_tenant_marker__';

@Injectable()
export class SeedService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upserts the demo tenant marker campaign under `DEMO_TENANT_SEED.ngoId`.
   * Idempotent: subsequent calls return `created: false` without touching the DB record.
   */
  async seedTenant(): Promise<SeedTenantResult> {
    const existing = await this.prisma.campaign.findFirst({
      where: {
        name: TENANT_MARKER_NAME,
        ngoId: DEMO_TENANT_SEED.ngoId,
      },
    });

    if (existing) {
      return { ngoId: DEMO_TENANT_SEED.ngoId, created: false };
    }

    await this.prisma.campaign.create({
      data: {
        name: TENANT_MARKER_NAME,
        status: 'draft',
        budget: 0,
        ngoId: DEMO_TENANT_SEED.ngoId,
        metadata: JSON.parse(
          JSON.stringify({
            description: DEMO_TENANT_SEED.description,
            region: DEMO_TENANT_SEED.region,
            isTenantMarker: true,
          }),
        ),
      },
    });

    return { ngoId: DEMO_TENANT_SEED.ngoId, created: true };
  }

  /**
   * Seeds demo campaigns from `DEMO_CAMPAIGN_SEEDS`.
   * Checks existence by `name` + `ngoId`; creates if absent, skips if present.
   */
  async seedCampaigns(): Promise<SeedCampaignsResult> {
    let created = 0;
    let skipped = 0;
    const campaignIds: string[] = [];

    for (const seed of DEMO_CAMPAIGN_SEEDS) {
      const existing = await this.prisma.campaign.findFirst({
        where: { name: seed.name, ngoId: DEMO_TENANT_SEED.ngoId },
      });

      if (existing) {
        skipped++;
        campaignIds.push(existing.id);
      } else {
        const record = await this.prisma.campaign.create({
          data: {
            name: seed.name,
            status: seed.status,
            budget: seed.budget,
            ngoId: DEMO_TENANT_SEED.ngoId,
            metadata: JSON.parse(JSON.stringify(seed.metadata)),
          },
        });
        created++;
        campaignIds.push(record.id);
      }
    }

    return { created, skipped, campaignIds };
  }

  /**
   * Seeds demo claims from `DEMO_CLAIM_SEEDS`.
   * Resolves each `campaignName` to a `campaignId` via DB lookup.
   * Throws `UnprocessableEntityException` (422) if a campaign is not found.
   * Checks existence by `recipientRef` + `campaignId`; creates if absent, skips if present.
   */
  async seedClaims(): Promise<SeedClaimsResult> {
    let created = 0;
    let skipped = 0;
    const claimIds: string[] = [];

    for (const seed of DEMO_CLAIM_SEEDS) {
      const campaign = await this.prisma.campaign.findFirst({
        where: { name: seed.campaignName, ngoId: DEMO_TENANT_SEED.ngoId },
      });

      if (!campaign) {
        throw new UnprocessableEntityException(
          `Demo campaign "${seed.campaignName}" not found. Run seedCampaigns() first.`,
        );
      }

      const existing = await this.prisma.claim.findFirst({
        where: { recipientRef: seed.recipientRef, campaignId: campaign.id },
      });

      if (existing) {
        skipped++;
        claimIds.push(existing.id);
      } else {
        const record = await this.prisma.claim.create({
          data: {
            campaignId: campaign.id,
            recipientRef: seed.recipientRef,
            amount: seed.amount,
            status: seed.status,
            evidenceRef: seed.evidenceRef,
          },
        });
        created++;
        claimIds.push(record.id);
      }
    }

    return { created, skipped, claimIds };
  }

  /**
   * Runs the full seed in order: tenant → campaigns → claims.
   * On any step failure, throws `InternalServerErrorException` identifying the failing step.
   */
  async seedAll(): Promise<SeedAllResult> {
    let tenant: SeedTenantResult;
    let campaigns: SeedCampaignsResult;
    let claims: SeedClaimsResult;

    try {
      tenant = await this.seedTenant();
    } catch (err) {
      throw new InternalServerErrorException(
        `Seed step "tenant" failed: ${(err as Error).message}`,
      );
    }

    try {
      campaigns = await this.seedCampaigns();
    } catch (err) {
      throw new InternalServerErrorException(
        `Seed step "campaigns" failed: ${(err as Error).message}`,
      );
    }

    try {
      claims = await this.seedClaims();
    } catch (err) {
      throw new InternalServerErrorException(
        `Seed step "claims" failed: ${(err as Error).message}`,
      );
    }

    return { tenant, campaigns, claims };
  }

  /**
   * Deletes all seeded demo records identified by seed shape markers.
   * Only removes records tied to `DEMO_TENANT_SEED.ngoId` (campaigns/tenant marker)
   * and seed `recipientRef` values (claims). Non-seeded records are never touched.
   * Returns zero counts when nothing exists.
   */
  async resetSeed(): Promise<ResetSeedResult> {
    const seedRecipientRefs = DEMO_CLAIM_SEEDS.map(s => s.recipientRef);

    // Delete seeded claims by recipientRef scoped to the demo ngoId campaigns
    const demoCampaigns = await this.prisma.campaign.findMany({
      where: { ngoId: DEMO_TENANT_SEED.ngoId },
      select: { id: true },
    });
    const demoCampaignIds = demoCampaigns.map(c => c.id);

    const deletedClaimsResult = await this.prisma.claim.deleteMany({
      where: {
        recipientRef: { in: seedRecipientRefs },
        campaignId: {
          in: demoCampaignIds.length ? demoCampaignIds : ['__none__'],
        },
      },
    });

    // Delete all campaigns (including tenant marker) under the demo ngoId
    const deletedCampaignsResult = await this.prisma.campaign.deleteMany({
      where: { ngoId: DEMO_TENANT_SEED.ngoId },
    });

    // Tenant marker is a campaign — count it separately from regular campaigns
    const deletedTenants = deletedCampaignsResult.count > 0 ? 1 : 0;
    const deletedCampaigns = Math.max(
      0,
      deletedCampaignsResult.count - deletedTenants,
    );

    return {
      deletedClaims: deletedClaimsResult.count,
      deletedCampaigns,
      deletedTenants,
    };
  }
}

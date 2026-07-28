import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  CampaignStatus,
  ClaimStatus,
  Prisma,
  SorobanOperationType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ExportCampaignsQueryDto } from './dto/export-campaigns.dto';

export interface CampaignExportRow {
  id: string;
  name: string;
  status: string;
  budget: number;
  orgId: string | null;
  ngoId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  totalClaims: number;
  totalDisbursed: number;
}

export interface CampaignExportResult {
  data: CampaignExportRow[];
  total: number;
  page: number;
  limit: number;
}

export interface CampaignTimelineMilestone {
  id: string;
  label: string;
  status: 'completed' | 'pending' | 'delayed' | 'failed';
  occurredAt?: Date;
  description: string;
  transactionHash?: string;
  explorerUrl?: string;
  correlationId?: string;
}

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  private sanitizeMetadata(
    metadata?: Record<string, unknown>,
  ): Prisma.InputJsonValue | undefined {
    if (!metadata) return undefined;
    return metadata as Prisma.InputJsonValue;
  }

  async create(dto: CreateCampaignDto, ngoId?: string | null) {
    return this.prisma.campaign.create({
      data: {
        name: dto.name,
        status: dto.status ?? CampaignStatus.draft,
        budget: dto.budget,
        metadata: this.sanitizeMetadata(dto.metadata),
        ngoId: ngoId ?? null,
      },
    });
  }

  async findAll(includeArchived = false, ngoId?: string | null) {
    const where: Prisma.CampaignWhereInput = {
      deletedAt: null,
      ...(includeArchived ? {} : { archivedAt: null }),
      ...(ngoId ? { ngoId } : {}),
    };

    return this.prisma.campaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
    });
    if (!campaign || (campaign as { deletedAt?: Date | null }).deletedAt) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }

  async getTimeline(id: string): Promise<CampaignTimelineMilestone[]> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        claims: {
          where: { deletedAt: null },
          include: { sorobanTransactions: true },
          orderBy: { createdAt: 'asc' },
        },
        balanceLedger: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!campaign || campaign.deletedAt) {
      throw new NotFoundException('Campaign not found');
    }

    const allTransactions = campaign.claims.flatMap(claim =>
      claim.sorobanTransactions.map(tx => ({ ...tx, claim })),
    );
    const claimTransactions = allTransactions.filter(
      tx => tx.operation === SorobanOperationType.create_claim,
    );
    const disburseTransactions = allTransactions.filter(
      tx => tx.operation === SorobanOperationType.disburse_claim,
    );
    const verifiedStatuses: ClaimStatus[] = [
      ClaimStatus.verified,
      ClaimStatus.approved,
      ClaimStatus.disbursed,
    ];
    const verifiedClaims = campaign.claims.filter(claim =>
      verifiedStatuses.includes(claim.status),
    );
    const disburseLedger = campaign.balanceLedger.filter(
      entry => entry.eventType === 'disburse',
    );

    const latestClaimTx = this.latestTransaction(claimTransactions);
    const latestDisburseTx = this.latestTransaction(disburseTransactions);
    const failedClaimTx = claimTransactions.find(tx => tx.status === 'failed');
    const failedDisburseTx = disburseTransactions.find(
      tx => tx.status === 'failed',
    );

    return [
      {
        id: 'issuance',
        label: 'Issuance',
        status:
          campaign.status === CampaignStatus.draft ? 'pending' : 'completed',
        occurredAt: campaign.createdAt,
        description:
          campaign.status === CampaignStatus.draft
            ? 'Campaign is drafted and awaiting activation.'
            : `Campaign issued with ${campaign.claims.length} claim record${campaign.claims.length === 1 ? '' : 's'}.`,
      },
      {
        id: 'verification',
        label: 'Verification',
        status: verifiedClaims.length > 0 ? 'completed' : 'pending',
        occurredAt: verifiedClaims.at(-1)?.updatedAt,
        description:
          verifiedClaims.length > 0
            ? `${verifiedClaims.length} claim${verifiedClaims.length === 1 ? '' : 's'} verified or approved.`
            : 'No verified claims have been recorded yet.',
      },
      {
        id: 'claim',
        label: 'Claim',
        status: this.milestoneStatus(latestClaimTx?.status, failedClaimTx),
        occurredAt:
          latestClaimTx?.confirmedAt ??
          latestClaimTx?.submittedAt ??
          latestClaimTx?.initiatedAt,
        description:
          claimTransactions.length > 0
            ? `${claimTransactions.length} onchain claim transaction${claimTransactions.length === 1 ? '' : 's'} tracked.`
            : 'Waiting for onchain claim transactions.',
        transactionHash: latestClaimTx?.txHash ?? undefined,
        explorerUrl: latestClaimTx?.txHash
          ? this.explorerTxUrl(latestClaimTx.txHash)
          : undefined,
        correlationId: latestClaimTx?.correlationId ?? undefined,
      },
      {
        id: 'disbursement',
        label: 'Disbursement',
        status:
          disburseLedger.length > 0
            ? 'completed'
            : this.milestoneStatus(latestDisburseTx?.status, failedDisburseTx),
        occurredAt:
          disburseLedger.at(-1)?.createdAt ??
          latestDisburseTx?.confirmedAt ??
          latestDisburseTx?.submittedAt ??
          latestDisburseTx?.initiatedAt,
        description:
          disburseLedger.length > 0
            ? `${disburseLedger.length} disbursement ledger event${disburseLedger.length === 1 ? '' : 's'} recorded.`
            : 'Disbursement has not been finalized yet.',
        transactionHash: latestDisburseTx?.txHash ?? undefined,
        explorerUrl: latestDisburseTx?.txHash
          ? this.explorerTxUrl(latestDisburseTx.txHash)
          : undefined,
        correlationId: latestDisburseTx?.correlationId ?? undefined,
      },
    ];
  }

  async update(id: string, dto: UpdateCampaignDto) {
    await this.findOne(id);

    return this.prisma.campaign.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status,
        budget: dto.budget,
        metadata:
          dto.metadata === undefined
            ? undefined
            : this.sanitizeMetadata(dto.metadata),
      },
    });
  }

  private latestTransaction<
    T extends {
      initiatedAt: Date;
      submittedAt: Date | null;
      confirmedAt: Date | null;
      failedAt: Date | null;
    },
  >(transactions: T[]): T | undefined {
    return [...transactions].sort((a, b) => {
      const aTime =
        a.confirmedAt ?? a.submittedAt ?? a.failedAt ?? a.initiatedAt;
      const bTime =
        b.confirmedAt ?? b.submittedAt ?? b.failedAt ?? b.initiatedAt;
      return bTime.getTime() - aTime.getTime();
    })[0];
  }

  private milestoneStatus(
    status?: string,
    failedTransaction?: unknown,
  ): CampaignTimelineMilestone['status'] {
    if (failedTransaction) return 'failed';
    if (status === 'confirmed') return 'completed';
    if (status === 'submitted' || status === 'pending') return 'delayed';
    return 'pending';
  }

  private explorerTxUrl(txHash: string): string {
    const network = process.env.STELLAR_NETWORK ?? 'testnet';
    const base =
      network.toLowerCase() === 'mainnet'
        ? 'https://stellar.expert/explorer/public'
        : 'https://stellar.expert/explorer/testnet';
    return `${base}/tx/${txHash}`;
  }

  async archive(id: string) {
    const existing = await this.findOne(id);

    if (existing.archivedAt) {
      return { campaign: existing, alreadyArchived: true };
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { archivedAt: new Date(), status: CampaignStatus.archived },
    });

    return { campaign: updated, alreadyArchived: false };
  }

  /** Soft-delete a campaign (sets deletedAt). */
  async softDelete(id: string) {
    await this.findOne(id);
    return this.prisma.campaign.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async exportCampaigns(
    query: ExportCampaignsQueryDto,
  ): Promise<CampaignExportResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.CampaignWhereInput = {
      deletedAt: null,
    };

    if (query.status) where.status = query.status;
    if (query.orgId) where.orgId = query.orgId;
    if (query.ngoId) where.ngoId = query.ngoId;

    if (query.from || query.to) {
      if (query.from && isNaN(Date.parse(query.from))) {
        throw new BadRequestException(`Invalid 'from' date: ${query.from}`);
      }
      if (query.to && isNaN(Date.parse(query.to))) {
        throw new BadRequestException(`Invalid 'to' date: ${query.to}`);
      }
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [campaignsResult, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: {
            select: { claims: true },
          },
          balanceLedger: {
            where: { eventType: 'disburse' },
          },
        },
      }),
      this.prisma.campaign.count({ where }),
    ]);

    // Use type assertion to handle Prisma client type limitations
    // Prisma schema has these fields but generated types may be stale
    const campaigns = campaignsResult as unknown as Array<{
      id: string;
      name: string;
      status: CampaignStatus;
      budget: number;
      orgId: string | null;
      ngoId: string | null;
      createdAt: Date;
      updatedAt: Date;
      archivedAt: Date | null;
      deletedAt: Date | null;
      _count: { claims: number };
      balanceLedger: Array<{ amount: number }>;
    }>;

    const data: CampaignExportRow[] = campaigns.map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      budget: c.budget,
      orgId: c.orgId ?? null,
      ngoId: c.ngoId ?? null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      archivedAt: c.archivedAt ?? null,
      totalClaims: c._count.claims,
      totalDisbursed: c.balanceLedger.reduce((sum, bl) => sum + bl.amount, 0),
    }));

    return { data, total, page, limit };
  }

  buildCsv(rows: CampaignExportRow[]): string {
    const escape = (value: string | number | null): string => {
      const str = String(value ?? '').replace(/"/g, '""');
      return `"${str}"`;
    };

    const header =
      'id,name,status,budget,orgId,ngoId,createdAt,updatedAt,archivedAt,totalClaims,totalDisbursed';
    const lines = rows.map(r =>
      [
        escape(r.id),
        escape(r.name),
        escape(r.status),
        escape(r.budget),
        escape(r.orgId),
        escape(r.ngoId),
        escape(r.createdAt.toISOString()),
        escape(r.updatedAt.toISOString()),
        escape(r.archivedAt?.toISOString() ?? ''),
        escape(r.totalClaims),
        escape(r.totalDisbursed.toFixed(2)),
      ].join(','),
    );

    return [header, ...lines].join('\r\n');
  }
}

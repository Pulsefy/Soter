import { AppException, ERROR_CODES } from '../common/dto/error-response.dto';
import { Injectable } from '@nestjs/common';
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
import { escapeCsvField, toCsvRow } from '../common/csv/csv.util';
import { streamCursorPaginate } from '../common/streaming/cursor-paginate';
import {
  CAMPAIGN_CONFIDENCE_THRESHOLD_KEY,
  ENTITY_LINK_CONFIDENCE_CONFIG,
  getCampaignConfidenceThreshold,
} from '../common/config/entity-link-confidence.config';

export interface CampaignConfidenceThresholds {
  reviewThreshold: number;
  rejectThreshold: number;
}

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

interface RawCampaignExportRow {
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

  private static readonly DEFAULT_CONFIDENCE_THRESHOLDS: CampaignConfidenceThresholds =
    {
      reviewThreshold: 0.6,
      rejectThreshold: 0.3,
    };

  private static readonly CONFIDENCE_THRESHOLD_METADATA_KEY =
    'confidenceThresholds';

  /**
   * Resolves the confidence thresholds that apply to a campaign. When the
   * campaign's anchor metadata carries a `confidenceThresholds` override, that
   * override is used; otherwise the global default bands are returned
   * unchanged.
   */
  getConfidenceThresholds(
    campaign:
      | { metadata?: Prisma.JsonValue | null }
      | null
      | undefined,
  ): CampaignConfidenceThresholds {
    const metadata = campaign?.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return CampaignsService.DEFAULT_CONFIDENCE_THRESHOLDS;
    }

    const raw = (metadata as Record<string, unknown>)[
      CampaignsService.CONFIDENCE_THRESHOLD_METADATA_KEY
    ];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return CampaignsService.DEFAULT_CONFIDENCE_THRESHOLDS;
    }

    const { reviewThreshold, rejectThreshold } = raw as Record;
      string,
      unknown
    >;
    if (
      typeof reviewThreshold !== 'number' ||
      typeof rejectThreshold !== 'number'
    ) {
      return CampaignsService.DEFAULT_CONFIDENCE_THRESHOLDS;
    }

    return { reviewThreshold, rejectThreshold };
  }

  /** Resolves the thresholds for a campaign by id. */
  async getConfidenceThresholdsForCampaign(
    id: string,
  ): Promise<CampaignConfidenceThresholds> {
    const campaign = await this.findOne(id);
    return this.getConfidenceThresholds(campaign);
  }

  /**
   * Resolves the effective confidence threshold for a campaign, preferring a
   * per-campaign override (stored in the campaign's metadata) when one is
   * supplied and falling back to the global default otherwise.
   */
  async getConfidenceThreshold(id: string): Promise<number> {
    const campaign = await this.findOne(id);
    const metadata =
      campaign.metadata && typeof campaign.metadata === 'object'
        ? (campaign.metadata as Record<string, unknown>)
        : null;
    const override = getCampaignConfidenceThreshold(metadata);
    return override ?? ENTITY_LINK_CONFIDENCE_CONFIG.AUTO_ACCEPT_THRESHOLD;
  }

  private sanitizeMetadata(
    metadata?: Record<string, unknown>,
  ): Prisma.InputJsonValue | undefined {
    if (!metadata) return undefined;
    return metadata as Prisma.InputJsonValue;
  }

  /**
   * Merges an optional confidence threshold override into the campaign
   * metadata blob, preserving any existing keys. When no override is supplied
   * the metadata is returned unchanged.
   */
  private withConfidenceThreshold(
    metadata: Record<string, unknown> | undefined,
    confidenceThreshold?: number,
  ): Record<string, unknown> | undefined {
    if (confidenceThreshold === undefined) {
      return metadata;
    }
    return {
      ...(metadata ?? {}),
      [CAMPAIGN_CONFIDENCE_THRESHOLD_KEY]: confidenceThreshold,
    };
  }

  async create(dto: CreateCampaignDto, ngoId?: string | null) {
    const metadata = this.withConfidenceThreshold(
      dto.metadata,
      dto.confidenceThreshold,
    );

    return this.prisma.campaign.create({
      data: {
        name: dto.name,
        status: dto.status ?? CampaignStatus.draft,
        budget: dto.budget,
        metadata: this.sanitizeMetadata(metadata),
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
      throw new AppException(ERROR_CODES.NOT_FOUND, 404, 'Campaign not found');
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
      throw new AppException(ERROR_CODES.NOT_FOUND, 404, 'Campaign not found');
    }

    const allTransactions = campaign.claims.flatMap(claim =>
      claim.sorobanTransactions.map(tx => ({ ...tx, claim }),
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
          latestClaimTx ?.initiatedAt,
        description:
          claimTransactions.length > 0
            ? `${claimTransactions.length} onchain claim transaction${claimTransactions.length === 1 ? '' : 's'} tracked.`
            : 'Waiting for onchain claim transactions.',
        transactionHash: latestClaimTx ?.txHash ?? undefined,
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
          latestDisburseTx ?.initiatedAt,
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
    const existing = await this.findOne(id);

    const metadata =
      dto.metadata === undefined && dto.confidenceThreshold === undefined
        ? undefined
        : this.withConfidenceThreshold(
            dto.metadata ??
              (existing.metadata && typeof existing.metadata === 'object'
                ? (existing.metadata as Record<string, unknown>)
                : undefined),
            dto.confidenceThreshold,
          );

    return this.prisma.campaign.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status,
        budget: dto.budget,
        metadata:
          metadata === undefined
            ? undefined
            : this.sanitizeMetadata(metadata),
      },
    });
  }

  private latestTransaction<
    Tx extends {
      initiatedAt: Date;
      submittedAt: Date | null;
      confirmedAt: Date | null;
      failedAt: Date | null;
    },
  >(transactions: TXz[]): TXz | undefined {
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
      network === 'public'
        ? 'https://stellarchain.org'
        : 'https://stellar.org';
    return `${base}/explorer/tx/${txHash}`;
  }

  async archive(id: string) {
    const campaign = await this.findOne(id);
    if (campaign.archivedAt) {
      return { alreadyArchived: true, campaign };
    }
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        status: CampaignStatus.archived,
        archivedAt: new Date(),
      },
    });
    return { alreadyArchived: false, campaign: updated };
  }

  async softDelete(id: string) {
    await this.findOne(id);
    return this.prisma.campaign.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async countExport(query: ExportCampaignsQueryDto): Promise<number> {
    const where = this.buildExportWhere(query);
    return this.prisma.campaign.count({ where });
  }

  async *streamExportRows(
    query: ExportCampaignsQueryDto,
  ): AsyncGenerator<CampaignExportRow> {
    const where = this.buildExportWhere(query);
    const batchSize = 500;

    const pages = streamCursorPaginate<any>(
      cursor =>
        this.prisma.campaign.findMany({
          where,
          orderBy: { id: 'asc' },
          take: batchSize,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: {
            _count: { select: { claims: true } },
            balanceLedger: { select: { amount: true } },
          },
        }),
      batchSize,
    );

    for await (const page of pages) {
      for (const raw of page as RawCampaignExportRow[]) {
        yield {
          id: raw.id,
          name: raw.name,
          status: raw.status,
          budget: Number(raw.budget),
          orgId: raw.orgId,
          ngoId: raw.ngoId,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
          archivedAt: raw.archivedAt,
          totalClaims: raw._count.claims,
          totalDisbursed: raw.balanceLedger.reduce(
            (sum, entry) => sum + Number(entry.amount),
            0,
          ),
        };
      }
    }
  }

  async *streamExportCsv(
    query: ExportCampaignsQueryDto,
  ): AsyncGenerator<string> {
    yield toCsvRow([
      'id',
      'name',
      'status',
      'budget',
      'orgId',
      'ngoId',
      'createdAt',
      'updatedAt',
      'archivedAt',
      'totalClaims',
      'totalDisbursed',
    ]);

    for await (const row of this.streamExportRows(query)) {
      yield toCsvRow([
        row.id,
        escapeCsvField(row.name),
        row.status,
        row.budget,
        row.orgId ?? '',
        row.ngoId ?? '',
        row.createdAt.toISOString(),
        row.updatedAt.toISOString(),
        row.archivedAt?.toISOString() ?? '',
        row.totalClaims,
        row.totalDisbursed,
      ]);
    }
  }

  private buildExportWhere(
    query: ExportCampaignsQueryDto,
  ): Prisma.CampaignWhereInput {
    const where: Prisma.CampaignWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.orgId) where.orgId = query.orgId;
    if (query.ngoId) where.ngoId = query.ngoId;
    if (query.from) {
      const from = new Date(query.from);
      if (Number.isNaN(from.getTime())) {
        throw new AppException(ERROR_CODES.BAD_REQUEST, 400, 'Invalid from date');
      }
      where.createdAt = { ...(where.createdAt as object), gte: from };
    }
    if (query.to) {
      const to = new Date(query.to);
      if (Number.isNaN(to.getTime())) {
        throw new AppException(ERROR_CODES.BAD_REQUEST, 400, 'Invalid to date');
      }
      where.createdAt = { ...(where.createdAt as object), lte: to };
    }
    return where;
  }
}

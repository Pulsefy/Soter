import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import type { EntityLink, Prisma, RegistryEntityType } from '@prisma/client';
import { EntityLinkReviewStatus } from '@prisma/client';
import {
  ENTITY_LINK_CONFIDENCE_CONFIG,
  getConfidenceBand,
} from '../common/config/entity-link-confidence.config';
import {
  CreateEntityLinkDto,
  LinkEntityResult,
  EntityLinkQueryDto,
  EntityLinkReviewQueueQueryDto,
  ReviewEntityLinkDto,
  RegistrySearchResult,
} from './dto/entity-link.dto';

@Injectable()
export class EntityLinkingService {
  private readonly logger = new Logger(EntityLinkingService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private metricsService: MetricsService,
  ) {}

  /**
   * Link an extracted entity to a canonical registry record
   */
  async linkEntity(dto: CreateEntityLinkDto): Promise<LinkEntityResult> {
    this.logger.log(
      `Linking entity "${dto.extractedName}" to ${dto.entityType} registry`,
    );

    // Validate confidence score
    if (dto.confidenceScore < 0 || dto.confidenceScore > 1) {
      throw new BadRequestException('Confidence score must be between 0 and 1');
    }

    // Find or create registry record
    let registryRecordId: string | null = null;
    let matchMethod = dto.matchMethod || 'manual';

    if (dto.registryId) {
      // Link to existing registry record
      registryRecordId = await this.findRegistryRecordById(
        dto.entityType,
        dto.registryId,
      );
      matchMethod = matchMethod === 'manual' ? 'manual' : 'exact';
    } else {
      // Try to find matching registry record by name
      const matchResult = await this.findBestRegistryMatch(
        dto.entityType,
        dto.extractedName,
        dto.confidenceScore,
      );

      if (matchResult) {
        registryRecordId = matchResult.id;
        matchMethod = matchResult.confidenceScore >= 0.95 ? 'exact' : 'fuzzy';
      }
    }

    // Confidence banding (issue #949): a link scoring below the
    // configured threshold is not applied - it enters the review queue
    // instead, so a human decides before it can corrupt registry data.
    const band = getConfidenceBand(dto.confidenceScore);
    const needsReview = band === 'needs_review';
    const now = new Date();

    // Create entity link
    const linkData: Prisma.EntityLinkUncheckedCreateInput = {
      sourceType: dto.sourceType,
      sourceId: dto.sourceId,
      extractedName: dto.extractedName,
      extractedType: dto.extractedType,
      entityType: dto.entityType,
      confidenceScore: dto.confidenceScore,
      matchMethod,
      metadata: (dto.metadata ?? null) as Prisma.InputJsonValue,
      reviewStatus: needsReview
        ? EntityLinkReviewStatus.pending_review
        : EntityLinkReviewStatus.auto_accepted,
      queuedAt: needsReview ? now : null,
      isActive: !needsReview,
    };

    // Set the appropriate registry relation
    if (registryRecordId) {
      switch (dto.entityType) {
        case 'organization':
          linkData.organizationId = registryRecordId;
          break;
        case 'location':
          linkData.locationId = registryRecordId;
          break;
        case 'asset':
          linkData.assetId = registryRecordId;
          break;
        case 'project':
          linkData.projectId = registryRecordId;
          break;
      }
    }

    const link = await this.prisma.entityLink.create({
      data: linkData,
    });

    if (needsReview) {
      this.metricsService.adjustEntityLinkReviewQueueDepth(dto.entityType, 1);
      this.logger.log(
        `Entity link ${link.id} queued for review (confidence ${link.confidenceScore} < ${ENTITY_LINK_CONFIDENCE_CONFIG.AUTO_ACCEPT_THRESHOLD})`,
      );
    } else {
      this.logger.log(
        `Entity link created: ${link.id} with confidence ${link.confidenceScore}`,
      );
    }

    await this.auditService.record({
      actorId: 'system',
      entity: 'EntityLink',
      entityId: link.id,
      action: needsReview ? 'queued_for_review' : 'auto_accepted',
      metadata: {
        sourceType: link.sourceType,
        sourceId: link.sourceId,
        entityType: link.entityType,
        confidenceScore: link.confidenceScore,
        matchMethod: link.matchMethod,
        threshold: ENTITY_LINK_CONFIDENCE_CONFIG.AUTO_ACCEPT_THRESHOLD,
      },
    });

    return this.mapLinkResult(link);
  }

  /**
   * List entity links currently awaiting review (confidence below the
   * configured threshold). Oldest-queued first, so reviewers work through
   * the backlog in order.
   */
  async getReviewQueue(query: EntityLinkReviewQueueQueryDto): Promise<{
    data: LinkEntityResult[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.EntityLinkWhereInput = {
      reviewStatus: EntityLinkReviewStatus.pending_review,
    };

    if (query.entityType) {
      where.entityType = query.entityType;
    }

    if (query.sourceType) {
      where.sourceType = query.sourceType;
    }

    const [links, total] = await Promise.all([
      this.prisma.entityLink.findMany({
        where,
        skip,
        take: limit,
        orderBy: { queuedAt: 'asc' },
      }),
      this.prisma.entityLink.count({ where }),
    ]);

    return {
      data: links.map(link => this.mapLinkResult(link)),
      total,
      page,
      limit,
    };
  }

  /**
   * A reviewer's decision on a queued link: accept it as-is, reject it
   * (deactivate, no registry data applied), or remap it to a different
   * registry entity. Only links currently pending review can be decided -
   * this is the queue's exit path.
   *
   * Every decision is audited (issue #949: "Review decisions are audited
   * and can feed back into scoring" - the audit metadata below carries the
   * original confidenceScore/matchMethod alongside the human verdict,
   * which is exactly the labeled data a future scoring recalibration would
   * need) and recorded as a metric (decision counter + queue-to-decision
   * latency histogram).
   */
  async decideReview(
    linkId: string,
    dto: ReviewEntityLinkDto,
    reviewerId: string,
  ): Promise<LinkEntityResult> {
    const link = await this.prisma.entityLink.findUnique({
      where: { id: linkId },
    });

    if (!link) {
      throw new NotFoundException(`Entity link ${linkId} not found`);
    }

    if (link.reviewStatus !== EntityLinkReviewStatus.pending_review) {
      throw new BadRequestException(
        `Entity link ${linkId} is not awaiting review (status: ${link.reviewStatus})`,
      );
    }

    const now = new Date();
    const updateData: Prisma.EntityLinkUncheckedUpdateInput = {
      reviewedBy: reviewerId,
      reviewedAt: now,
      reviewNotes: dto.reviewNotes,
    };

    switch (dto.action) {
      case 'accept':
        updateData.reviewStatus = EntityLinkReviewStatus.accepted;
        updateData.isActive = true;
        break;

      case 'reject':
        updateData.reviewStatus = EntityLinkReviewStatus.rejected;
        updateData.isActive = false;
        break;

      case 'remap': {
        if (!dto.remapEntityType || !dto.remapRegistryId) {
          throw new BadRequestException(
            'remapEntityType and remapRegistryId are required for a remap decision',
          );
        }
        const newRegistryRecordId = await this.findRegistryRecordById(
          dto.remapEntityType,
          dto.remapRegistryId,
        );

        // Clear every registry relation first so remapping across entity
        // types (e.g. organization -> location) can't leave a stale FK.
        updateData.organizationId = null;
        updateData.locationId = null;
        updateData.assetId = null;
        updateData.projectId = null;

        switch (dto.remapEntityType) {
          case 'organization':
            updateData.organizationId = newRegistryRecordId;
            break;
          case 'location':
            updateData.locationId = newRegistryRecordId;
            break;
          case 'asset':
            updateData.assetId = newRegistryRecordId;
            break;
          case 'project':
            updateData.projectId = newRegistryRecordId;
            break;
        }

        updateData.entityType = dto.remapEntityType;
        updateData.matchMethod = 'manual';
        updateData.confidenceScore = 1.0;
        updateData.reviewStatus = EntityLinkReviewStatus.remapped;
        updateData.isActive = true;
        break;
      }

      default:
        // dto arrives as an untyped HTTP body, so a client can send an
        // action outside the EntityLinkReviewAction union at runtime even
        // though the switch above is exhaustive at compile time.
        throw new BadRequestException(
          `Unknown review action: ${String(dto.action)}`,
        );
    }

    const updated = await this.prisma.entityLink.update({
      where: { id: linkId },
      data: updateData,
    });

    this.metricsService.adjustEntityLinkReviewQueueDepth(link.entityType, -1);
    this.metricsService.incrementEntityLinkReviewDecision(dto.action);

    const queuedAt = link.queuedAt ?? link.createdAt;
    const decisionLatencySeconds = (now.getTime() - queuedAt.getTime()) / 1000;
    this.metricsService.recordEntityLinkReviewDuration(
      dto.action,
      decisionLatencySeconds,
    );

    await this.auditService.record({
      actorId: reviewerId,
      entity: 'EntityLink',
      entityId: linkId,
      action: `review_${dto.action}`,
      metadata: {
        decision: dto.action,
        reviewNotes: dto.reviewNotes ?? null,
        decisionLatencySeconds,
        previous: {
          entityType: link.entityType,
          organizationId: link.organizationId,
          locationId: link.locationId,
          assetId: link.assetId,
          projectId: link.projectId,
          confidenceScore: link.confidenceScore,
          matchMethod: link.matchMethod,
        },
        current: {
          entityType: updated.entityType,
          organizationId: updated.organizationId,
          locationId: updated.locationId,
          assetId: updated.assetId,
          projectId: updated.projectId,
          confidenceScore: updated.confidenceScore,
          matchMethod: updated.matchMethod,
        },
      },
    });

    return this.mapLinkResult(updated);
  }

  /**
   * Query entity links by various criteria
   */
  async queryLinks(query: EntityLinkQueryDto): Promise<{
    data: LinkEntityResult[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.EntityLinkWhereInput = {};

    if (query.sourceType) {
      where.sourceType = query.sourceType;
    }

    if (query.sourceId) {
      where.sourceId = query.sourceId;
    }

    if (query.entityType) {
      where.entityType = query.entityType;
    }

    if (query.minConfidence !== undefined) {
      where.confidenceScore = { gte: query.minConfidence };
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.reviewStatus) {
      where.reviewStatus = query.reviewStatus;
    }

    const [links, total] = await Promise.all([
      this.prisma.entityLink.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.entityLink.count({ where }),
    ]);

    return {
      data: links.map(link => this.mapLinkResult(link)),
      total,
      page,
      limit,
    };
  }

  /**
   * Get entity links for a specific campaign
   */
  async getLinksByCampaign(
    campaignId: string,
    entityType?: string,
  ): Promise<LinkEntityResult[]> {
    const where: Prisma.EntityLinkWhereInput = {
      sourceType: 'campaign',
      sourceId: campaignId,
    };

    if (entityType) {
      where.entityType = entityType as RegistryEntityType;
    }

    const links = await this.prisma.entityLink.findMany({
      where,
      orderBy: { confidenceScore: 'desc' },
    });

    return links.map(link => this.mapLinkResult(link));
  }

  /**
   * Get entity links for a specific claim
   */
  async getLinksByClaim(
    claimId: string,
    entityType?: string,
  ): Promise<LinkEntityResult[]> {
    const where: Prisma.EntityLinkWhereInput = {
      sourceType: 'claim',
      sourceId: claimId,
    };

    if (entityType) {
      where.entityType = entityType as RegistryEntityType;
    }

    const links = await this.prisma.entityLink.findMany({
      where,
      orderBy: { confidenceScore: 'desc' },
    });

    return links.map(link => this.mapLinkResult(link));
  }

  /**
   * Get entity links for a specific verification
   */
  async getLinksByVerification(
    verificationId: string,
    entityType?: string,
  ): Promise<LinkEntityResult[]> {
    const where: Prisma.EntityLinkWhereInput = {
      sourceType: 'verification',
      sourceId: verificationId,
    };

    if (entityType) {
      where.entityType = entityType as RegistryEntityType;
    }

    const links = await this.prisma.entityLink.findMany({
      where,
      orderBy: { confidenceScore: 'desc' },
    });

    return links.map(link => this.mapLinkResult(link));
  }

  /**
   * Search registry for potential matches
   */
  async searchRegistry(
    entityType: 'organization' | 'location' | 'asset' | 'project',
    query: string,
    limit: number = 10,
  ): Promise<RegistrySearchResult[]> {
    this.logger.log(`Searching ${entityType} registry for "${query}"`);

    const results: RegistrySearchResult[] = [];

    switch (entityType) {
      case 'organization': {
        const orgs = await this.prisma.registryOrganization.findMany({
          where: {
            OR: [
              { name: { contains: query } },
              { aliases: { contains: query } },
            ],
          },
          take: limit,
        });

        results.push(
          ...orgs.map(org => ({
            id: org.id,
            registryId: org.registryId,
            name: org.name,
            entityType: 'organization',
            confidenceScore:
              org.name.toLowerCase() === query.toLowerCase() ? 1.0 : 0.8,
            matchMethod:
              org.name.toLowerCase() === query.toLowerCase()
                ? 'exact'
                : 'fuzzy',
          })),
        );
        break;
      }

      case 'location': {
        const locations = await this.prisma.registryLocation.findMany({
          where: {
            OR: [
              { name: { contains: query } },
              { aliases: { contains: query } },
              { country: { contains: query } },
              { region: { contains: query } },
            ],
          },
          take: limit,
        });

        results.push(
          ...locations.map(loc => ({
            id: loc.id,
            registryId: loc.registryId,
            name: loc.name,
            entityType: 'location',
            confidenceScore:
              loc.name.toLowerCase() === query.toLowerCase() ? 1.0 : 0.75,
            matchMethod:
              loc.name.toLowerCase() === query.toLowerCase()
                ? 'exact'
                : 'fuzzy',
          })),
        );
        break;
      }

      case 'asset': {
        const assets = await this.prisma.registryAsset.findMany({
          where: {
            OR: [
              { name: { contains: query } },
              { type: { contains: query } },
              { category: { contains: query } },
            ],
          },
          take: limit,
        });

        results.push(
          ...assets.map(asset => ({
            id: asset.id,
            registryId: asset.registryId,
            name: asset.name,
            entityType: 'asset',
            confidenceScore:
              asset.name.toLowerCase() === query.toLowerCase() ? 1.0 : 0.75,
            matchMethod:
              asset.name.toLowerCase() === query.toLowerCase()
                ? 'exact'
                : 'fuzzy',
          })),
        );
        break;
      }

      case 'project': {
        const projects = await this.prisma.registryProject.findMany({
          where: {
            OR: [
              { name: { contains: query } },
              { description: { contains: query } },
            ],
          },
          take: limit,
        });

        results.push(
          ...projects.map(proj => ({
            id: proj.id,
            registryId: proj.registryId,
            name: proj.name,
            entityType: 'project',
            confidenceScore:
              proj.name.toLowerCase() === query.toLowerCase() ? 1.0 : 0.75,
            matchMethod:
              proj.name.toLowerCase() === query.toLowerCase()
                ? 'exact'
                : 'fuzzy',
          })),
        );
        break;
      }
    }

    return results
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, limit);
  }

  /**
   * Helper: Find registry record by ID
   */
  private async findRegistryRecordById(
    entityType: string,
    registryId: string,
  ): Promise<string> {
    switch (entityType) {
      case 'organization': {
        const org = await this.prisma.registryOrganization.findUnique({
          where: { registryId },
        });
        if (!org) {
          throw new NotFoundException(
            `Organization with registry ID ${registryId} not found`,
          );
        }
        return org.id;
      }

      case 'location': {
        const loc = await this.prisma.registryLocation.findUnique({
          where: { registryId },
        });
        if (!loc) {
          throw new NotFoundException(
            `Location with registry ID ${registryId} not found`,
          );
        }
        return loc.id;
      }

      case 'asset': {
        const asset = await this.prisma.registryAsset.findUnique({
          where: { registryId },
        });
        if (!asset) {
          throw new NotFoundException(
            `Asset with registry ID ${registryId} not found`,
          );
        }
        return asset.id;
      }

      case 'project': {
        const proj = await this.prisma.registryProject.findUnique({
          where: { registryId },
        });
        if (!proj) {
          throw new NotFoundException(
            `Project with registry ID ${registryId} not found`,
          );
        }
        return proj.id;
      }

      default:
        throw new BadRequestException(`Invalid entity type: ${entityType}`);
    }
  }

  /**
   * Helper: Find best matching registry record by name
   */
  private async findBestRegistryMatch(
    entityType: string,
    name: string,
    _minConfidence: number,
  ): Promise<{ id: string; confidenceScore: number } | null> {
    // Exact match first
    switch (entityType) {
      case 'organization': {
        const org = await this.prisma.registryOrganization.findFirst({
          where: {
            OR: [{ name: { equals: name } }, { aliases: { contains: name } }],
          },
        });

        if (org) {
          return {
            id: org.id,
            confidenceScore:
              org.name.toLowerCase() === name.toLowerCase() ? 1.0 : 0.85,
          };
        }
        break;
      }

      case 'location': {
        const loc = await this.prisma.registryLocation.findFirst({
          where: {
            OR: [{ name: { equals: name } }, { aliases: { contains: name } }],
          },
        });

        if (loc) {
          return {
            id: loc.id,
            confidenceScore:
              loc.name.toLowerCase() === name.toLowerCase() ? 1.0 : 0.85,
          };
        }
        break;
      }

      case 'asset': {
        const asset = await this.prisma.registryAsset.findFirst({
          where: {
            OR: [{ name: { equals: name } }, { category: { contains: name } }],
          },
        });

        if (asset) {
          return {
            id: asset.id,
            confidenceScore:
              asset.name.toLowerCase() === name.toLowerCase() ? 1.0 : 0.85,
          };
        }
        break;
      }

      case 'project': {
        const proj = await this.prisma.registryProject.findFirst({
          where: {
            OR: [
              { name: { equals: name } },
              { description: { contains: name } },
            ],
          },
        });

        if (proj) {
          return {
            id: proj.id,
            confidenceScore:
              proj.name.toLowerCase() === name.toLowerCase() ? 1.0 : 0.85,
          };
        }
        break;
      }
    }

    return null;
  }

  /**
   * Helper: Map Prisma entity link to result DTO
   */
  private mapLinkResult(link: EntityLink): LinkEntityResult {
    return {
      id: link.id,
      sourceType: link.sourceType,
      sourceId: link.sourceId,
      extractedName: link.extractedName,
      extractedType: link.extractedType,
      entityType: link.entityType,
      organizationId: link.organizationId,
      locationId: link.locationId,
      assetId: link.assetId,
      projectId: link.projectId,
      confidenceScore: link.confidenceScore,
      matchMethod: link.matchMethod,
      reviewStatus: link.reviewStatus,
      queuedAt: link.queuedAt,
      isActive: link.isActive,
      reviewedBy: link.reviewedBy,
      reviewedAt: link.reviewedAt,
      reviewNotes: link.reviewNotes,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };
  }
}

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateEntityLinkDto,
  LinkEntityResult,
  EntityLinkQueryDto,
  RegistrySearchResult,
} from './dto/entity-link.dto';

@Injectable()
export class EntityLinkingService {
  private readonly logger = new Logger(EntityLinkingService.name);

  constructor(private prisma: PrismaService) {}

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

    // Create entity link
    const linkData: any = {
      sourceType: dto.sourceType,
      sourceId: dto.sourceId,
      extractedName: dto.extractedName,
      extractedType: dto.extractedType,
      entityType: dto.entityType,
      confidenceScore: dto.confidenceScore,
      matchMethod,
      metadata: dto.metadata ? JSON.parse(JSON.stringify(dto.metadata)) : null,
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

    this.logger.log(
      `Entity link created: ${link.id} with confidence ${link.confidenceScore}`,
    );

    return this.mapLinkResult(link);
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

    const where: any = {};

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
    const where: any = {
      sourceType: 'campaign',
      sourceId: campaignId,
    };

    if (entityType) {
      where.entityType = entityType;
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
    const where: any = {
      sourceType: 'claim',
      sourceId: claimId,
    };

    if (entityType) {
      where.entityType = entityType;
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
    const where: any = {
      sourceType: 'verification',
      sourceId: verificationId,
    };

    if (entityType) {
      where.entityType = entityType;
    }

    const links = await this.prisma.entityLink.findMany({
      where,
      orderBy: { confidenceScore: 'desc' },
    });

    return links.map(link => this.mapLinkResult(link));
  }

  /**
   * Review and update an entity link (manual curation)
   */
  async reviewLink(
    linkId: string,
    reviewData: { reviewedBy: string; isActive: boolean; reviewNotes?: string },
  ): Promise<LinkEntityResult> {
    this.logger.log(
      `Reviewing entity link ${linkId} by ${reviewData.reviewedBy}`,
    );

    const updated = await this.prisma.entityLink.update({
      where: { id: linkId },
      data: {
        reviewedBy: reviewData.reviewedBy,
        reviewedAt: new Date(),
        isActive: reviewData.isActive,
        reviewNotes: reviewData.reviewNotes,
      },
    });

    return this.mapLinkResult(updated);
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
  private mapLinkResult(link: any): LinkEntityResult {
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
      isActive: link.isActive,
      reviewedBy: link.reviewedBy,
      reviewedAt: link.reviewedAt,
      reviewNotes: link.reviewNotes,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { CampaignStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  private sanitizeMetadata(
    metadata?: Record<string, unknown>,
  ): Prisma.InputJsonValue | undefined {
    if (!metadata) return undefined;
    return metadata as Prisma.InputJsonValue;
  }

  async create(dto: CreateCampaignDto) {
    return this.prisma.campaign.create({
      data: {
        name: dto.name,
        status: dto.status ?? CampaignStatus.draft,
        budget: dto.budget,
        metadata: this.sanitizeMetadata(dto.metadata),
      },
    });
  }

  async findAll(includeArchived = false) {
    return this.prisma.campaign.findMany({
      where: includeArchived ? undefined : { archivedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
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
}

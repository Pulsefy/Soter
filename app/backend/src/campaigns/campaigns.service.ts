import { Injectable, NotFoundException } from '@nestjs/common';
import { CampaignStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { BudgetAlertsService } from './budget-alerts.service';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgetAlertsService: BudgetAlertsService,
  ) {}

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
    if (!campaign || campaign.deletedAt) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }

  async update(id: string, dto: UpdateCampaignDto) {
    const existing = await this.findOne(id);
    const budgetChanged = dto.budget !== undefined && dto.budget !== existing.budget;

    const updated = await this.prisma.campaign.update({
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

    // Reset budget alerts if budget was changed
    if (budgetChanged) {
      await this.budgetAlertsService.resetAlerts(id);
    }

    return updated;
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
}

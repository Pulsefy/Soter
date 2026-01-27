import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { ClaimStatus } from '@prisma/client';

@Injectable()
export class ClaimsService {
  constructor(private prisma: PrismaService) {}

  async create(createClaimDto: CreateClaimDto) {
    // Check if campaign exists
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: createClaimDto.campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const claim = await this.prisma.claim.create({
      data: {
        campaignId: createClaimDto.campaignId,
        amount: createClaimDto.amount,
        recipientRef: createClaimDto.recipientRef,
        evidenceRef: createClaimDto.evidenceRef,
      },
      include: {
        campaign: true,
      },
    });

    // Stub audit hook
    void this.auditLog('claim', claim.id, 'created', { status: claim.status });

    return claim;
  }

  async findAll() {
    return this.prisma.claim.findMany({
      include: {
        campaign: true,
      },
    });
  }

  async findOne(id: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: {
        campaign: true,
      },
    });
    if (!claim) {
      throw new NotFoundException('Claim not found');
    }
    return claim;
  }

  async verify(id: string) {
    return this.transitionStatus(
      id,
      ClaimStatus.requested,
      ClaimStatus.verified,
    );
  }

  async approve(id: string) {
    return this.transitionStatus(
      id,
      ClaimStatus.verified,
      ClaimStatus.approved,
    );
  }

  async disburse(id: string) {
    return this.transitionStatus(
      id,
      ClaimStatus.approved,
      ClaimStatus.disbursed,
    );
  }

  async archive(id: string) {
    return this.transitionStatus(
      id,
      ClaimStatus.disbursed,
      ClaimStatus.archived,
    );
  }

  private async transitionStatus(
    id: string,
    fromStatus: ClaimStatus,
    toStatus: ClaimStatus,
  ) {
    const claim = await this.prisma.claim.findUnique({ where: { id } });
    if (!claim) {
      throw new NotFoundException('Claim not found');
    }
    if (claim.status !== fromStatus) {
      throw new BadRequestException(
        `Cannot transition from ${claim.status} to ${toStatus}`,
      );
    }

    // For disburse, check budget? But for now, skip as per requirements.

    const updatedClaim = await this.prisma.$transaction(async tx => {
      const updated = await tx.claim.update({
        where: { id },
        data: { status: toStatus },
        include: { campaign: true },
      });

      // Stub audit hook
      void this.auditLog('claim', id, `status_changed_to_${toStatus}`, {
        from: fromStatus,
        to: toStatus,
      });

      return updated;
    });

    return updatedClaim;
  }

  private auditLog(
    entity: string,
    entityId: string,
    action: string,
    metadata?: any,
  ) {
    // Stub: In production, this would log to audit table or external system
    console.log(`Audit: ${entity} ${entityId} ${action}`, metadata);
  }
}

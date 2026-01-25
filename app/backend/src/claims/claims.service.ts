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
    const campaign = await this.prisma.aidPackage.findUnique({
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
    });

    // Stub audit hook
    this.auditHook('Claim created', claim.id);

    return claim;
  }

  async findAll() {
    return this.prisma.claim.findMany({
      include: { campaign: true },
    });
  }

  async findOne(id: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id },
      include: { campaign: true },
    });
    if (!claim) {
      throw new NotFoundException('Claim not found');
    }
    return claim;
  }

  async verify(id: string) {
    return this.transition(
      id,
      ClaimStatus.requested,
      ClaimStatus.verified,
      'Claim verified',
    );
  }

  async approve(id: string) {
    return this.transition(
      id,
      ClaimStatus.verified,
      ClaimStatus.approved,
      'Claim approved',
    );
  }

  async disburse(id: string) {
    return this.transition(
      id,
      ClaimStatus.approved,
      ClaimStatus.disbursed,
      'Claim disbursed',
    );
  }

  async archive(id: string) {
    return this.transition(
      id,
      ClaimStatus.disbursed,
      ClaimStatus.archived,
      'Claim archived',
    );
  }

  private async transition(
    id: string,
    from: ClaimStatus,
    to: ClaimStatus,
    auditMessage: string,
  ) {
    const result = await this.prisma.$transaction(async tx => {
      const claim = await tx.claim.findUnique({
        where: { id },
      });
      if (!claim) {
        throw new NotFoundException('Claim not found');
      }
      if (claim.status !== from) {
        throw new BadRequestException(
          `Cannot transition from ${claim.status} to ${to}`,
        );
      }

      const updatedClaim = await tx.claim.update({
        where: { id },
        data: { status: to },
      });

      // Stub audit hook
      this.auditHook(auditMessage, id);

      return updatedClaim;
    });

    return result;
  }

  private auditHook(message: string, claimId: string) {
    // Stub: log to console
    console.log(`Audit: ${message} for claim ${claimId}`);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL') || 'http://localhost:8000';
  }

  async analyzePendingClaimsBatch() {
    this.logger.log('Starting batch fraud analysis for pending claims');
    
    // New claims
    const pendingClaims = await this.prisma.claim.findMany({
      where: { fraudRiskScore: null },
      take: 100,
    });

    if (pendingClaims.length === 0) {
      this.logger.log('No pending claims to analyze');
      return [];
    }

    // Historical claims for context (last 500)
    const historicalClaims = await this.prisma.claim.findMany({
      where: { fraudRiskScore: { not: null } },
      take: 500,
      orderBy: { createdAt: 'desc' },
    });

    const combinedClaims = [...pendingClaims, ...historicalClaims];

    try {
      // Map to the format expected by the AI service
      const payload = {
        claims: combinedClaims.map(c => ({
          id: c.id,
          amount: Number(c.amount),
          recipientRef: c.recipientRef,
          evidenceRef: c.evidenceRef,
          ipAddress: c.ipAddress,
        }))
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.aiServiceUrl}/analyze-batch`, payload),
      );

      const analyzedMap = new Map(response.data.map((c: any) => [c.id, c.fraudRiskScore]));

      // Update only the originally pending claims
      for (const pending of pendingClaims) {
        const newScore = analyzedMap.get(pending.id);
        if (newScore !== undefined) {
          await this.prisma.claim.update({
            where: { id: pending.id },
            data: { fraudRiskScore: newScore },
          });
        }
      }

      this.logger.log(`Successfully analyzed and updated ${pendingClaims.length} claims against ${historicalClaims.length} historical records.`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to analyze claims batch', error);
      throw error;
    }
  }
}

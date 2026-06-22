import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppRole } from '../auth/app-role.enum';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

type Actor = { apiKeyId?: string; authType?: string; role?: AppRole };

const maskPreview = (rawKey: string): string => {
  const prefix = rawKey.slice(0, 6);
  const suffix = rawKey.slice(-4);
  return `${prefix}...${suffix}`;
};

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  private newRawKey(): string {
    return `s2s_${randomBytes(32).toString('base64url')}`;
  }

  private actorId(actor: Actor | undefined): string {
    if (actor?.apiKeyId) return actor.apiKeyId;
    if (actor?.authType === 'envApiKey') return 'env:API_KEY';
    if (actor?.role) return `role:${actor.role}`;
    return 'unknown';
  }

  async create(dto: CreateApiKeyDto, actor?: Actor) {
    if (dto.role === AppRole.ngo && !dto.ngoId) {
      throw new BadRequestException('ngoId is required for NGO API keys');
    }

    const rawKey = this.newRawKey();
    const keyHash = sha256Hex(rawKey);
    const keyPreview = maskPreview(rawKey);

    const row = await this.prisma.apiKey.create({
      data: {
        keyHash,
        keyPreview,
        role: dto.role,
        ngoId: dto.ngoId ?? null,
        description: dto.description ?? null,
        createdBy: this.actorId(actor),
      },
      select: {
        id: true,
        role: true,
        ngoId: true,
        description: true,
        createdAt: true,
        lastUsedAt: true,
        createdBy: true,
        revokedAt: true,
        revokedBy: true,
        revokedReason: true,
        replacedById: true,
        keyPreview: true,
      },
    });

    return { ...row, apiKey: rawKey };
  }

  async list() {
    const rows = await this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        role: true,
        ngoId: true,
        description: true,
        createdAt: true,
        lastUsedAt: true,
        createdBy: true,
        revokedAt: true,
        revokedBy: true,
        revokedReason: true,
        replacedById: true,
        keyPreview: true,
      },
    });

    return rows;
  }

  async revoke(id: string, reason: string | undefined, actor?: Actor) {
    const existing = await this.prisma.apiKey.findUnique({
      where: { id },
      select: { id: true, revokedAt: true },
    });
    if (!existing) {
      throw new NotFoundException('API key not found');
    }

    if (existing.revokedAt) {
      return this.prisma.apiKey.findUnique({
        where: { id },
        select: {
          id: true,
          role: true,
          ngoId: true,
          description: true,
          createdAt: true,
          lastUsedAt: true,
          createdBy: true,
          revokedAt: true,
          revokedBy: true,
          revokedReason: true,
          replacedById: true,
          keyPreview: true,
        },
      });
    }

    return this.prisma.apiKey.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        revokedBy: this.actorId(actor),
        revokedReason: reason ?? 'revoked',
      },
      select: {
        id: true,
        role: true,
        ngoId: true,
        description: true,
        createdAt: true,
        lastUsedAt: true,
        createdBy: true,
        revokedAt: true,
        revokedBy: true,
        revokedReason: true,
        replacedById: true,
        keyPreview: true,
      },
    });
  }

  async rotate(id: string, actor?: Actor) {
    return this.prisma.$transaction(async tx => {
      const existing = await tx.apiKey.findUnique({
        where: { id },
        select: {
          id: true,
          role: true,
          ngoId: true,
          description: true,
          revokedAt: true,
        },
      });
      if (!existing) {
        throw new NotFoundException('API key not found');
      }
      if (existing.revokedAt) {
        throw new BadRequestException('Cannot rotate a revoked API key');
      }

      const rawKey = this.newRawKey();
      const keyHash = sha256Hex(rawKey);
      const keyPreview = maskPreview(rawKey);

      const replacement = await tx.apiKey.create({
        data: {
          keyHash,
          keyPreview,
          role: existing.role,
          ngoId: existing.ngoId,
          description: existing.description,
          createdBy: this.actorId(actor),
        },
        select: {
          id: true,
          role: true,
          ngoId: true,
          description: true,
          createdAt: true,
          lastUsedAt: true,
          createdBy: true,
          revokedAt: true,
          revokedBy: true,
          revokedReason: true,
          replacedById: true,
          keyPreview: true,
        },
      });

      await tx.apiKey.update({
        where: { id: existing.id },
        data: {
          revokedAt: new Date(),
          revokedBy: this.actorId(actor),
          revokedReason: 'rotated',
          replacedById: replacement.id,
        },
      });

      return { replacement, apiKey: rawKey };
    });
  }
}

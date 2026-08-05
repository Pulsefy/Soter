import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

type Actor = { userId?: string; orgId?: string; role?: string };

const selectFields = {
  id: true,
  userId: true,
  orgId: true,
  platform: true,
  deviceId: true,
  token: true,
  deviceName: true,
  appVersion: true,
  isActive: true,
  lastUsedAt: true,
  revokedAt: true,
  revokedBy: true,
  revokedReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class DeviceTokensService {
  constructor(private readonly prisma: PrismaService) {}

  private actorId(actor: Actor | undefined): string {
    if (actor?.userId) return actor.userId;
    if (actor?.role) return `role:${actor.role}`;
    return 'unknown';
  }

  /**
   * Register or update a device notification token.
   * Idempotent: if the same (userId, deviceId, platform) exists, it updates the token.
   */
  async register(dto: RegisterDeviceTokenDto, actor?: Actor) {
    const { userId, orgId } = actor || {};

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    // Check if device token already exists
    const existing = await this.prisma.deviceNotificationToken.findUnique({
      where: {
        userId_deviceId_platform: {
          userId,
          deviceId: dto.deviceId,
          platform: dto.platform,
        },
      },
    });

    if (existing) {
      // Update existing token (rotation)
      const updated = await this.prisma.deviceNotificationToken.update({
        where: { id: existing.id },
        data: {
          token: dto.token,
          deviceName: dto.deviceName,
          appVersion: dto.appVersion,
          isActive: true,
          revokedAt: null,
          revokedBy: null,
          revokedReason: null,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        },
        select: selectFields,
      });

      return updated;
    }

    // Create new token
    const created = await this.prisma.deviceNotificationToken.create({
      data: {
        userId,
        orgId,
        platform: dto.platform,
        deviceId: dto.deviceId,
        token: dto.token,
        deviceName: dto.deviceName,
        appVersion: dto.appVersion,
        isActive: true,
        lastUsedAt: new Date(),
      },
      select: selectFields,
    });

    return created;
  }

  /**
   * List all device tokens for the authenticated user.
   */
  async list(userId: string) {
    const tokens = await this.prisma.deviceNotificationToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: selectFields,
    });

    return tokens;
  }

  /**
   * Get a specific device token by ID.
   */
  async get(id: string, userId: string) {
    const token = await this.prisma.deviceNotificationToken.findFirst({
      where: { id, userId },
      select: selectFields,
    });

    if (!token) {
      throw new NotFoundException('Device token not found');
    }

    return token;
  }

  /**
   * Revoke a device token.
   */
  async revoke(id: string, reason: string | undefined, actor?: Actor) {
    const { userId } = actor || {};

    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const existing = await this.prisma.deviceNotificationToken.findFirst({
      where: { id, userId },
      select: { id: true, revokedAt: true },
    });

    if (!existing) {
      throw new NotFoundException('Device token not found');
    }

    if (existing.revokedAt) {
      // Already revoked, return as-is
      const token = await this.prisma.deviceNotificationToken.findFirst({
        where: { id, userId },
        select: selectFields,
      });
      return token!;
    }

    const updated = await this.prisma.deviceNotificationToken.update({
      where: { id },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedBy: this.actorId(actor),
        revokedReason: reason ?? 'revoked',
      },
      select: selectFields,
    });

    return updated;
  }

  /**
   * Delete a device token permanently.
   */
  async delete(id: string, userId: string) {
    const existing = await this.prisma.deviceNotificationToken.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Device token not found');
    }

    await this.prisma.deviceNotificationToken.delete({
      where: { id },
    });

    return { id };
  }

  /**
   * Update last used timestamp for a token.
   */
  async updateLastUsed(id: string, userId: string) {
    const token = await this.prisma.deviceNotificationToken.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!token) {
      throw new NotFoundException('Device token not found');
    }

    await this.prisma.deviceNotificationToken.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });

    return { id };
  }
}

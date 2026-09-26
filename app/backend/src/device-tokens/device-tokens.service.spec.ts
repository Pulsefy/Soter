import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeviceTokensService } from './device-tokens.service';
import { PrismaService } from '../prisma/prisma.service';
import { DevicePlatform } from '@prisma/client';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

describe('DeviceTokensService', () => {
  let service: DeviceTokensService;

  const mockPrisma = {
    deviceNotificationToken: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceTokensService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<DeviceTokensService>(DeviceTokensService);
  });

  describe('register', () => {
    it('creates a new device token', async () => {
      const dto: RegisterDeviceTokenDto = {
        platform: DevicePlatform.ios,
        deviceId: 'device-123',
        token: 'apns-token-abc',
        deviceName: 'iPhone 14',
        appVersion: '1.0.0',
      };

      mockPrisma.deviceNotificationToken.findUnique.mockResolvedValue(null);
      mockPrisma.deviceNotificationToken.create.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        orgId: 'org-1',
        platform: DevicePlatform.ios,
        deviceId: 'device-123',
        token: 'apns-token-abc',
        deviceName: 'iPhone 14',
        appVersion: '1.0.0',
        isActive: true,
        lastUsedAt: expect.any(Date),
        revokedAt: null,
        revokedBy: null,
        revokedReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.register(dto, {
        userId: 'user-1',
        orgId: 'org-1',
      });

      expect(result.id).toBe('token-1');
      expect(result.token).toBe('apns-token-abc');
      expect(mockPrisma.deviceNotificationToken.create).toHaveBeenCalled();
    });

    it('updates existing token (idempotent)', async () => {
      const dto: RegisterDeviceTokenDto = {
        platform: DevicePlatform.ios,
        deviceId: 'device-123',
        token: 'new-apns-token',
        deviceName: 'iPhone 14',
        appVersion: '1.0.1',
      };

      mockPrisma.deviceNotificationToken.findUnique.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        orgId: 'org-1',
        platform: DevicePlatform.ios,
        deviceId: 'device-123',
        token: 'old-apns-token',
      });

      mockPrisma.deviceNotificationToken.update.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        orgId: 'org-1',
        platform: DevicePlatform.ios,
        deviceId: 'device-123',
        token: 'new-apns-token',
        deviceName: 'iPhone 14',
        appVersion: '1.0.1',
        isActive: true,
        lastUsedAt: expect.any(Date),
        revokedAt: null,
        revokedBy: null,
        revokedReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.register(dto, {
        userId: 'user-1',
        orgId: 'org-1',
      });

      expect(result.token).toBe('new-apns-token');
      expect(mockPrisma.deviceNotificationToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            token: 'new-apns-token',
            isActive: true,
            revokedAt: null,
          }),
        }),
      );
    });

    it('throws BadRequestException when userId is missing', async () => {
      const dto: RegisterDeviceTokenDto = {
        platform: DevicePlatform.ios,
        deviceId: 'device-123',
        token: 'apns-token-abc',
      };

      await expect(service.register(dto, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('list', () => {
    it('returns all device tokens for a user', async () => {
      mockPrisma.deviceNotificationToken.findMany.mockResolvedValue([
        {
          id: 'token-1',
          userId: 'user-1',
          platform: DevicePlatform.ios,
          deviceId: 'device-1',
          token: 'apns-token-1',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'token-2',
          userId: 'user-1',
          platform: DevicePlatform.android,
          deviceId: 'device-2',
          token: 'fcm-token-1',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.list('user-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.deviceNotificationToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
        }),
      );
    });
  });

  describe('get', () => {
    it('returns a specific device token', async () => {
      mockPrisma.deviceNotificationToken.findFirst.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        platform: DevicePlatform.ios,
        deviceId: 'device-1',
        token: 'apns-token-1',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.get('token-1', 'user-1');

      expect(result.id).toBe('token-1');
    });

    it('throws NotFoundException when token not found', async () => {
      mockPrisma.deviceNotificationToken.findFirst.mockResolvedValue(null);

      await expect(service.get('token-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('revoke', () => {
    it('revokes a device token', async () => {
      mockPrisma.deviceNotificationToken.findFirst.mockResolvedValue({
        id: 'token-1',
        revokedAt: null,
      });

      mockPrisma.deviceNotificationToken.findFirst.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        platform: DevicePlatform.ios,
        deviceId: 'device-1',
        token: 'apns-token-1',
        isActive: false,
        revokedAt: expect.any(Date),
        revokedBy: 'user-1',
        revokedReason: 'User logged out',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrisma.deviceNotificationToken.update.mockResolvedValue({
        id: 'token-1',
        isActive: false,
        revokedAt: expect.any(Date),
        revokedBy: 'user-1',
        revokedReason: 'User logged out',
      });

      const result = await service.revoke('token-1', 'User logged out', {
        userId: 'user-1',
      });

      expect(result.isActive).toBe(false);
      expect(result.revokedReason).toBe('User logged out');
    });

    it('throws NotFoundException when token not found', async () => {
      mockPrisma.deviceNotificationToken.findFirst.mockResolvedValue(null);

      await expect(
        service.revoke('token-1', 'reason', { userId: 'user-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns existing token if already revoked', async () => {
      mockPrisma.deviceNotificationToken.findFirst.mockResolvedValue({
        id: 'token-1',
        revokedAt: new Date(),
      });

      mockPrisma.deviceNotificationToken.findFirst.mockResolvedValue({
        id: 'token-1',
        isActive: false,
        revokedAt: new Date(),
      });

      const result = await service.revoke('token-1', 'reason', {
        userId: 'user-1',
      });

      expect(result.isActive).toBe(false);
      expect(mockPrisma.deviceNotificationToken.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes a device token', async () => {
      mockPrisma.deviceNotificationToken.findFirst.mockResolvedValue({
        id: 'token-1',
      });

      mockPrisma.deviceNotificationToken.delete.mockResolvedValue({});

      const result = await service.delete('token-1', 'user-1');

      expect(result.id).toBe('token-1');
      expect(mockPrisma.deviceNotificationToken.delete).toHaveBeenCalledWith({
        where: { id: 'token-1' },
      });
    });

    it('throws NotFoundException when token not found', async () => {
      mockPrisma.deviceNotificationToken.findFirst.mockResolvedValue(null);

      await expect(service.delete('token-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateLastUsed', () => {
    it('updates last used timestamp', async () => {
      mockPrisma.deviceNotificationToken.findFirst.mockResolvedValue({
        id: 'token-1',
      });

      mockPrisma.deviceNotificationToken.update.mockResolvedValue({});

      const result = await service.updateLastUsed('token-1', 'user-1');

      expect(result.id).toBe('token-1');
      expect(mockPrisma.deviceNotificationToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it('throws NotFoundException when token not found', async () => {
      mockPrisma.deviceNotificationToken.findFirst.mockResolvedValue(null);

      await expect(service.updateLastUsed('token-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

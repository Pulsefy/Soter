import { Test, TestingModule } from '@nestjs/testing';
import { VersionConfigService } from './version-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { VersionPlatform } from '@prisma/client';

describe('VersionConfigService', () => {
  let service: VersionConfigService;

  const mockPrismaService = {
    versionConfig: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VersionConfigService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<VersionConfigService>(VersionConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new version config', async () => {
      const dto = {
        platform: VersionPlatform.web,
        currentVersion: '1.5.0',
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        forceUpgrade: false,
        releaseNotes: {
          version: '1.5.0',
          title: "What's New",
          changes: ['Improved verification'],
        },
        iosStoreUrl: 'https://apps.apple.com/app/soter',
        androidStoreUrl:
          'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
      };

      const expectedConfig = {
        id: 'config-1',
        platform: VersionPlatform.web,
        currentVersion: '1.5.0',
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        forceUpgrade: false,
        releaseNotes: dto.releaseNotes,
        iosStoreUrl: 'https://apps.apple.com/app/soter',
        androidStoreUrl:
          'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.versionConfig.create.mockResolvedValue(expectedConfig);

      const result = await service.create(dto);

      expect(mockPrismaService.versionConfig.create).toHaveBeenCalledWith({
        data: {
          platform: VersionPlatform.web,
          currentVersion: '1.5.0',
          latestVersion: '1.5.0',
          minRequiredVersion: '1.4.0',
          forceUpgrade: false,
          releaseNotes: dto.releaseNotes,
          iosStoreUrl: 'https://apps.apple.com/app/soter',
          androidStoreUrl:
            'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
        },
      });
      expect(result).toEqual(expectedConfig);
    });
  });

  describe('findAll', () => {
    it('should return all version configs', async () => {
      const configs = [
        {
          id: 'config-1',
          platform: VersionPlatform.web,
          currentVersion: '1.5.0',
          latestVersion: '1.5.0',
          minRequiredVersion: '1.4.0',
          forceUpgrade: false,
          releaseNotes: null,
          iosStoreUrl: null,
          androidStoreUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'config-2',
          platform: VersionPlatform.ios,
          currentVersion: '1.5.0',
          latestVersion: '1.5.0',
          minRequiredVersion: '1.4.0',
          forceUpgrade: true,
          releaseNotes: null,
          iosStoreUrl: 'https://apps.apple.com/app/soter',
          androidStoreUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrismaService.versionConfig.findMany.mockResolvedValue(configs);

      const result = await service.findAll();

      expect(mockPrismaService.versionConfig.findMany).toHaveBeenCalledWith({
        orderBy: { platform: 'asc' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('findByPlatform', () => {
    it('should return version config for a platform', async () => {
      const config = {
        id: 'config-1',
        platform: VersionPlatform.web,
        currentVersion: '1.5.0',
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        forceUpgrade: false,
        releaseNotes: null,
        iosStoreUrl: null,
        androidStoreUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.versionConfig.findUnique.mockResolvedValue(config);

      const result = await service.findByPlatform('web');

      expect(mockPrismaService.versionConfig.findUnique).toHaveBeenCalledWith({
        where: { platform: VersionPlatform.web },
      });
      expect(result).toEqual(config);
    });

    it('should return null if config not found', async () => {
      mockPrismaService.versionConfig.findUnique.mockResolvedValue(null);

      const result = await service.findByPlatform('web');

      expect(result).toBeNull();
    });
  });

  describe('findPublicByPlatform', () => {
    it('should return public version config for a platform', async () => {
      const config = {
        id: 'config-1',
        platform: VersionPlatform.web,
        currentVersion: '1.5.0',
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        forceUpgrade: false,
        releaseNotes: {
          version: '1.5.0',
          title: "What's New",
          changes: ['Improved verification', 'Faster loading'],
        },
        iosStoreUrl: 'https://apps.apple.com/app/soter',
        androidStoreUrl:
          'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.versionConfig.findUnique.mockResolvedValue(config);

      const result = await service.findPublicByPlatform('web');

      expect(result).toEqual({
        platform: 'web',
        currentVersion: '1.5.0',
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        forceUpgrade: false,
        releaseNotes: {
          version: '1.5.0',
          title: "What's New",
          changes: ['Improved verification', 'Faster loading'],
        },
        releaseNotesArray: ['Improved verification', 'Faster loading'],
        storeUrl: {
          ios: 'https://apps.apple.com/app/soter',
          android:
            'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
        },
      });
    });

    it('should return default config when no database config exists', async () => {
      mockPrismaService.versionConfig.findUnique.mockResolvedValue(null);

      const result = await service.findPublicByPlatform('web');

      expect(result).toEqual({
        platform: 'web',
        currentVersion: '1.4.0',
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        forceUpgrade: false,
        releaseNotes: {
          version: '1.5.0',
          title: "What's New",
          changes: [
            'Improved beneficiary verification',
            'Faster voucher loading',
            'Offline sync improvements',
            'Enhanced security measures',
          ],
        },
        releaseNotesArray: [
          'Improved beneficiary verification',
          'Faster voucher loading',
          'Offline sync improvements',
          'Enhanced security measures',
        ],
        storeUrl: {
          ios: 'https://apps.apple.com/app/soter',
          android:
            'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
        },
      });
    });

    it('should return iOS-specific store URL for iOS platform default', async () => {
      mockPrismaService.versionConfig.findUnique.mockResolvedValue(null);

      const result = await service.findPublicByPlatform('ios');

      expect(result.storeUrl).toEqual({
        ios: 'https://apps.apple.com/app/soter',
        android: '',
      });
    });

    it('should return Android-specific store URL for Android platform default', async () => {
      mockPrismaService.versionConfig.findUnique.mockResolvedValue(null);

      const result = await service.findPublicByPlatform('android');

      expect(result.storeUrl).toEqual({
        ios: '',
        android:
          'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
      });
    });

    it('should handle force upgrade flag correctly', async () => {
      const config = {
        id: 'config-1',
        platform: VersionPlatform.ios,
        currentVersion: '1.4.0',
        latestVersion: '1.5.0',
        minRequiredVersion: '1.5.0',
        forceUpgrade: true,
        releaseNotes: null,
        iosStoreUrl: 'https://apps.apple.com/app/soter',
        androidStoreUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.versionConfig.findUnique.mockResolvedValue(config);

      const result = await service.findPublicByPlatform('ios');

      expect(result.forceUpgrade).toBe(true);
      expect(result.minRequiredVersion).toBe('1.5.0');
    });
  });

  describe('update', () => {
    it('should update version config', async () => {
      const dto = {
        currentVersion: '1.6.0',
        latestVersion: '1.6.0',
        minRequiredVersion: '1.5.0',
        forceUpgrade: true,
      };

      const updatedConfig = {
        id: 'config-1',
        platform: VersionPlatform.web,
        currentVersion: '1.6.0',
        latestVersion: '1.6.0',
        minRequiredVersion: '1.5.0',
        forceUpgrade: true,
        releaseNotes: null,
        iosStoreUrl: null,
        androidStoreUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.versionConfig.update.mockResolvedValue(updatedConfig);

      const result = await service.update('config-1', dto);

      expect(mockPrismaService.versionConfig.update).toHaveBeenCalledWith({
        where: { id: 'config-1' },
        data: dto,
      });
      expect(result).toEqual(updatedConfig);
    });
  });

  describe('delete', () => {
    it('should delete version config', async () => {
      mockPrismaService.versionConfig.delete.mockResolvedValue(undefined);

      await service.delete('config-1');

      expect(mockPrismaService.versionConfig.delete).toHaveBeenCalledWith({
        where: { id: 'config-1' },
      });
    });
  });
});

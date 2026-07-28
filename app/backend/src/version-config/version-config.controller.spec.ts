import { Test, TestingModule } from '@nestjs/testing';
import { VersionConfigController } from './version-config.controller';
import { VersionConfigService } from './version-config.service';
import { VersionPlatform } from '@prisma/client';

describe('VersionConfigController', () => {
  let controller: VersionConfigController;
  let service: VersionConfigService;

  const mockVersionConfigService = {
    findPublicByPlatform: jest.fn(),
    create: jest.fn(),
    findAll: jest.fn(),
    findByPlatform: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VersionConfigController],
      providers: [
        {
          provide: VersionConfigService,
          useValue: mockVersionConfigService,
        },
      ],
    }).compile();

    controller = module.get<VersionConfigController>(VersionConfigController);
    service = module.get<VersionConfigService>(VersionConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPublicConfig', () => {
    it('should return public version config for web platform', async () => {
      const expectedConfig = {
        platform: 'web',
        currentVersion: '1.5.0',
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        forceUpgrade: false,
        releaseNotes: {
          version: '1.5.0',
          title: "What's New",
          changes: ['Improved verification'],
        },
        releaseNotesArray: ['Improved verification'],
        storeUrl: {
          ios: 'https://apps.apple.com/app/soter',
          android:
            'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
        },
      };

      mockVersionConfigService.findPublicByPlatform.mockResolvedValue(
        expectedConfig,
      );

      const result = await controller.getPublicConfig('web');

      expect(service.findPublicByPlatform).toHaveBeenCalledWith('web');
      expect(result).toEqual(expectedConfig);
    });

    it('should return public version config for iOS platform', async () => {
      const expectedConfig = {
        platform: 'ios',
        currentVersion: '1.5.0',
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        forceUpgrade: false,
        releaseNotes: {
          version: '1.5.0',
          title: "What's New",
          changes: ['Improved verification'],
        },
        releaseNotesArray: ['Improved verification'],
        storeUrl: {
          ios: 'https://apps.apple.com/app/soter',
          android: '',
        },
      };

      mockVersionConfigService.findPublicByPlatform.mockResolvedValue(
        expectedConfig,
      );

      const result = await controller.getPublicConfig('ios');

      expect(service.findPublicByPlatform).toHaveBeenCalledWith('ios');
      expect(result).toEqual(expectedConfig);
    });

    it('should return public version config for Android platform', async () => {
      const expectedConfig = {
        platform: 'android',
        currentVersion: '1.5.0',
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        forceUpgrade: false,
        releaseNotes: {
          version: '1.5.0',
          title: "What's New",
          changes: ['Improved verification'],
        },
        releaseNotesArray: ['Improved verification'],
        storeUrl: {
          ios: '',
          android:
            'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
        },
      };

      mockVersionConfigService.findPublicByPlatform.mockResolvedValue(
        expectedConfig,
      );

      const result = await controller.getPublicConfig('android');

      expect(service.findPublicByPlatform).toHaveBeenCalledWith('android');
      expect(result).toEqual(expectedConfig);
    });

    it('should return default config when platform is not specified', async () => {
      const expectedConfig = {
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
          ],
        },
        releaseNotesArray: [
          'Improved beneficiary verification',
          'Faster voucher loading',
        ],
        storeUrl: {
          ios: 'https://apps.apple.com/app/soter',
          android:
            'https://play.google.com/store/apps/details?id=org.pulsefy.soter.mobile',
        },
      };

      mockVersionConfigService.findPublicByPlatform.mockResolvedValue(
        expectedConfig,
      );

      const result = await controller.getPublicConfig();

      expect(service.findPublicByPlatform).toHaveBeenCalledWith('web');
      expect(result).toEqual(expectedConfig);
    });

    it('should handle force upgrade flag correctly', async () => {
      const expectedConfig = {
        platform: 'ios',
        currentVersion: '1.4.0',
        latestVersion: '1.5.0',
        minRequiredVersion: '1.5.0',
        forceUpgrade: true,
        releaseNotes: {
          version: '1.5.0',
          title: 'Critical Update Required',
          changes: ['Security fix'],
        },
        releaseNotesArray: ['Security fix'],
        storeUrl: {
          ios: 'https://apps.apple.com/app/soter',
          android: '',
        },
      };

      mockVersionConfigService.findPublicByPlatform.mockResolvedValue(
        expectedConfig,
      );

      const result = await controller.getPublicConfig('ios');

      expect(result.forceUpgrade).toBe(true);
      expect(result.minRequiredVersion).toBe('1.5.0');
    });
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
        ...dto,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockVersionConfigService.create.mockResolvedValue(expectedConfig);

      const result = await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
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
      ];

      mockVersionConfigService.findAll.mockResolvedValue(configs);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toEqual(configs);
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

      mockVersionConfigService.findByPlatform.mockResolvedValue(config);

      const result = await controller.findByPlatform('web');

      expect(service.findByPlatform).toHaveBeenCalledWith('web');
      expect(result).toEqual(config);
    });

    it('should return message when config not found', async () => {
      mockVersionConfigService.findByPlatform.mockResolvedValue(null);

      const result = await controller.findByPlatform('web');

      expect(result).toEqual({
        message: 'No version config found for platform: web',
      });
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
        ...dto,
        releaseNotes: null,
        iosStoreUrl: null,
        androidStoreUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockVersionConfigService.update.mockResolvedValue(updatedConfig);

      const result = await controller.update('config-1', dto);

      expect(service.update).toHaveBeenCalledWith('config-1', dto);
      expect(result).toEqual(updatedConfig);
    });
  });

  describe('delete', () => {
    it('should delete version config', async () => {
      mockVersionConfigService.delete.mockResolvedValue(undefined);

      await controller.delete('config-1');

      expect(service.delete).toHaveBeenCalledWith('config-1');
    });
  });
});

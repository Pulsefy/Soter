import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReleaseConfigService } from './release-config.service';

describe('AppController', () => {
  let appController: AppController;
  let releaseConfigService: ReleaseConfigService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        ReleaseConfigService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    releaseConfigService = app.get<ReleaseConfigService>(ReleaseConfigService);
  });

  describe('root', () => {
    it('should return welcome message', () => {
      expect(appController.getHello()).toEqual({
        message: 'Welcome to Pulsefy/Soter API',
        version: 'v1',
        docs: '/api/docs',
        endpoints: {
          health: '/api/v1/health',
          aid: '/api/v1/aid',
          verification: '/api/v1/verification',
        },
      });
    });
  });

  describe('config version', () => {
    it('should return backend-managed release metadata for web', () => {
      expect(appController.getConfigVersion('web')).toEqual(
        releaseConfigService.getConfig('web'),
      );
    });

    it('should tailor store links for ios clients', () => {
      const response = appController.getConfigVersion('ios');
      expect(response.platform).toBe('ios');
      expect(response.storeUrl.ios).toContain('apps.apple.com');
      expect(response.storeUrl.android).toBe('');
      expect(response.releaseNotes.changelogUrl).toContain('/changelog');
      expect(response.forceUpgradeScreen.updateLabel).toBe('Update App');
    });
  });
});

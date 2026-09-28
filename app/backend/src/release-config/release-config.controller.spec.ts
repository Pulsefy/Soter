import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ReleaseConfigQueryDto,
  ReleasePlatform,
} from './dto/release-config.dto';
import { ReleaseConfigController } from './release-config.controller';
import { ReleaseConfigService } from './release-config.service';

describe('ReleaseConfigController', () => {
  let controller: ReleaseConfigController;
  let configValues: Record<string, string>;

  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  };

  beforeEach(async () => {
    configValues = {};

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReleaseConfigController],
      providers: [
        ReleaseConfigService,
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    controller = module.get<ReleaseConfigController>(ReleaseConfigController);

    jest.clearAllMocks();
  });

  it('returns the default release configuration without forcing an upgrade', () => {
    const query: ReleaseConfigQueryDto = {
      platform: ReleasePlatform.WEB,
    };

    const result = controller.getConfigVersion(query);

    expect(result).toEqual(
      expect.objectContaining({
        platform: ReleasePlatform.WEB,
        currentVersion: '1.4.0',
        latestVersion: '1.5.0',
        minRequiredVersion: '1.4.0',
        forceUpgrade: false,
      }),
    );

    expect(result.releaseNotes.changes).toHaveLength(4);
    expect(result.releaseNotesArray).toEqual(result.releaseNotes.changes);
  });

  it('returns a forced-upgrade response for the configured platform only', () => {
    configValues = {
      RELEASE_MOBILE_LATEST_VERSION: '2.0.0',
      RELEASE_MOBILE_MIN_REQUIRED_VERSION: '2.0.0',
      RELEASE_MOBILE_FORCE_UPGRADE: 'true',
    };

    const mobileResult = controller.getConfigVersion({
      platform: ReleasePlatform.MOBILE,
    });

    const webResult = controller.getConfigVersion({
      platform: ReleasePlatform.WEB,
    });

    expect(mobileResult).toEqual(
      expect.objectContaining({
        platform: ReleasePlatform.MOBILE,
        latestVersion: '2.0.0',
        minRequiredVersion: '2.0.0',
        forceUpgrade: true,
      }),
    );

    expect(webResult.forceUpgrade).toBe(false);
  });
});

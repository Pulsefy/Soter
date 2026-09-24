import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import {
  STORAGE_CONFIG,
  STORAGE_DRIVER,
  createStorageDriver,
} from './storage.factory';
import { StorageConfig, parseStorageConfig } from './storage.config';
import { StorageService } from './storage.service';

/**
 * Provides the configured, pluggable {@link StorageService}.
 *
 * The backend is chosen by `STORAGE_DRIVER` (validated at startup) and can be
 * `local` (default), `s3` (S3-compatible / MinIO), or `mock` (tests only).
 * Marked `@Global` so any module can inject {@link StorageService} without
 * re-importing this module.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_CONFIG,
      useFactory: (configService: ConfigService): StorageConfig => {
        const env: Record<string, unknown> = {};
        const keys = [
          'STORAGE_DRIVER',
          'STORAGE_LOCAL_DIR',
          'STORAGE_S3_BUCKET',
          'STORAGE_S3_REGION',
          'STORAGE_S3_ENDPOINT',
          'STORAGE_S3_ACCESS_KEY_ID',
          'STORAGE_S3_SECRET_ACCESS_KEY',
          'STORAGE_S3_FORCE_PATH_STYLE',
        ];
        for (const key of keys) {
          env[key] = configService.get<string>(key);
        }
        return parseStorageConfig(env);
      },
      inject: [ConfigService],
    },
    {
      provide: STORAGE_DRIVER,
      useFactory: (config: StorageConfig) => createStorageDriver(config),
      inject: [STORAGE_CONFIG],
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}

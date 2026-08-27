import { tmpdir } from 'os';
import { join } from 'path';
import * as crypto from 'crypto';

import { StorageDriver } from './storage-driver.interface';
import { LocalStorageDriver } from './local-storage.driver';
import { MockStorageDriver } from './mock-storage.driver';
import {
  StorageDeleteError,
  StorageDownloadError,
  StorageError,
  StorageUploadError,
} from './storage.errors';
import { parseStorageConfig } from './storage.config';

function randomKey(): string {
  return `evidence/global/${crypto.randomUUID()}.enc`;
}

function makeDrivers(): { name: string; driver: StorageDriver }[] {
  const dir = join(tmpdir(), `soter-storage-test-${crypto.randomUUID()}`);
  return [
    { name: 'local', driver: new LocalStorageDriver({ baseDir: dir }) },
    { name: 'mock', driver: new MockStorageDriver() },
  ];
}

describe('StorageDriver implementations', () => {
  for (const { name, driver } of makeDrivers()) {
    describe(name, () => {
      it('uploads and downloads the exact bytes', async () => {
        const key = randomKey();
        const data = Buffer.from('top-secret-evidence');

        const result = await driver.upload(key, data);
        expect(result.key).toBe(key);

        const downloaded = await driver.download(key);
        expect(downloaded.equals(data)).toBe(true);
      });

      it('reports existence correctly', async () => {
        const key = randomKey();
        expect(await driver.exists(key)).toBe(false);
        await driver.upload(key, Buffer.from('x'));
        expect(await driver.exists(key)).toBe(true);
      });

      it('removes stored objects', async () => {
        const key = randomKey();
        await driver.upload(key, Buffer.from('x'));
        await driver.remove(key);
        expect(await driver.exists(key)).toBe(false);
      });

      it('throws a typed StorageError when downloading a missing object', async () => {
        await expect(driver.download(randomKey())).rejects.toBeInstanceOf(
          StorageError,
        );
      });
    });
  }

  describe('LocalStorageDriver', () => {
    it('rejects path traversal outside the storage root', async () => {
      const driver = new LocalStorageDriver({
        baseDir: join(tmpdir(), `soter-storage-root-${crypto.randomUUID()}`),
      });
      await expect(
        driver.upload('../../escape.txt', Buffer.from('x')),
      ).rejects.toBeInstanceOf(StorageError);
    });
  });

  describe('MockStorageDriver', () => {
    it('is not the default and only selected explicitly', () => {
      // Default backend is local, never mock.
      expect(parseStorageConfig({}).driver).toBe('local');
      expect(parseStorageConfig({ STORAGE_DRIVER: 'mock' }).driver).toBe(
        'mock',
      );
    });
  });
});

describe('parseStorageConfig', () => {
  it('defaults to the local driver when unset', () => {
    expect(parseStorageConfig({}).driver).toBe('local');
  });

  it('rejects an unknown driver', () => {
    expect(() => parseStorageConfig({ STORAGE_DRIVER: 'ftp' })).toThrow(
      /Invalid STORAGE_DRIVER/,
    );
  });

  it('requires bucket and region for s3', () => {
    expect(() => parseStorageConfig({ STORAGE_DRIVER: 's3' })).toThrow(
      /STORAGE_S3_BUCKET/,
    );
    expect(() =>
      parseStorageConfig({ STORAGE_DRIVER: 's3', STORAGE_S3_BUCKET: 'b' }),
    ).toThrow(/STORAGE_S3_REGION/);
  });

  it('parses a complete s3 config', () => {
    const cfg = parseStorageConfig({
      STORAGE_DRIVER: 's3',
      STORAGE_S3_BUCKET: 'my-bucket',
      STORAGE_S3_REGION: 'us-east-1',
      STORAGE_S3_ENDPOINT: 'http://localhost:9000',
      STORAGE_S3_FORCE_PATH_STYLE: 'true',
    });
    expect(cfg.driver).toBe('s3');
    expect(cfg.s3).toMatchObject({
      bucket: 'my-bucket',
      region: 'us-east-1',
      endpoint: 'http://localhost:9000',
      forcePathStyle: true,
    });
  });

  it('enables forcePathStyle automatically when an endpoint is set', () => {
    const cfg = parseStorageConfig({
      STORAGE_DRIVER: 's3',
      STORAGE_S3_BUCKET: 'b',
      STORAGE_S3_REGION: 'r',
      STORAGE_S3_ENDPOINT: 'http://minio:9000',
    });
    expect(cfg.s3?.forcePathStyle).toBe(true);
  });
});

describe('Storage typed errors', () => {
  it('StorageUploadError carries the key', () => {
    const err = new StorageUploadError('evidence/x.enc', new Error('boom'));
    expect(err).toBeInstanceOf(StorageError);
    expect(err.key).toBe('evidence/x.enc');
    expect(err.message).toContain('evidence/x.enc');
  });

  it('StorageDeleteError and StorageDownloadError are StorageErrors', () => {
    expect(new StorageDeleteError('k')).toBeInstanceOf(StorageError);
    expect(new StorageDownloadError('k')).toBeInstanceOf(StorageError);
  });
});

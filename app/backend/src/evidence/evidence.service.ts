import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { AuditService } from '../audit/audit.service';
import { FingerprintService } from './fingerprint.service';
import { StorageService } from './storage/storage.service';
import { StorageError } from './storage/storage.errors';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EvidenceStatus } from '@prisma/client';

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);
  private readonly uploadDir = path.join(process.cwd(), 'uploads', 'evidence');

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly auditService: AuditService,
    private readonly fingerprintService: FingerprintService,
    private readonly storageService: StorageService,
  ) {
    // Ensure staging directory exists (encrypted bytes land here before the
    // durable upload to the configured StorageDriver).
    if (!existsSync(this.uploadDir)) {
      mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async queueEvidence(
    file: Express.Multer.File,
    ownerId: string,
    orgId?: string,
  ) {
    const fileHash = crypto
      .createHash('sha256')
      .update(file.buffer)
      .digest('hex');

    // Generate stable fingerprint for near-duplicate detection
    const fingerprint = this.fingerprintService.generateFileFingerprint(
      file.buffer,
    );

    // Check for exact duplicate within org scope
    const orgScopeFilter = orgId ? { orgId } : {};
    const existingExact = await this.prisma.evidenceQueueItem.findFirst({
      where: {
        fileHash,
        ...orgScopeFilter,
      },
    });

    if (existingExact) {
      this.logger.warn(
        `Exact duplicate upload detected for hash ${fileHash} in org ${orgId}`,
      );
      await this.auditService.record({
        actorId: ownerId,
        entity: 'evidence_queue',
        entityId: existingExact.id,
        action: 'duplicate_upload_rejected',
        metadata: {
          fileName: file.originalname,
          size: file.size,
          duplicateOf: existingExact.id,
          orgId,
        },
      });
      throw new BadRequestException(
        'File already exists in queue for this organization',
      );
    }

    // Check for near-duplicates within org scope
    const existingNear = await this.prisma.evidenceQueueItem.findFirst({
      where: {
        fingerprint,
        ...orgScopeFilter,
        nearDuplicateOf: null, // Only check against original items
      },
    });

    if (existingNear) {
      this.logger.warn(
        `Near-duplicate upload detected for fingerprint ${fingerprint} in org ${orgId}`,
      );

      // Create a near-duplicate record that references the original
      const nearDuplicateItem = await this.prisma.evidenceQueueItem.create({
        data: {
          fileName: file.originalname,
          filePath: null, // Don't store duplicate files
          fileHash,
          fingerprint,
          mimeType: file.mimetype,
          size: file.size,
          ownerId,
          orgId,
          status: EvidenceStatus.completed, // Mark as completed since it's a duplicate
          nearDuplicateOf: existingNear.id,
          metadata: {
            isNearDuplicate: true,
            originalId: existingNear.id,
          },
        },
      });

      await this.auditService.record({
        actorId: ownerId,
        entity: 'evidence_queue',
        entityId: nearDuplicateItem.id,
        action: 'near_duplicate_upload',
        metadata: {
          fileName: file.originalname,
          size: file.size,
          nearDuplicateOf: existingNear.id,
          orgId,
        },
      });

      return nearDuplicateItem;
    }

    // Encrypt file buffer
    const encryptedBuffer = this.encryptionService.encryptBuffer(file.buffer);

    // Stage the encrypted bytes locally before the durable upload runs
    // asynchronously in processUpload.
    const stagingName = `${crypto.randomUUID()}.enc`;
    const stagingPath = path.join(this.uploadDir, stagingName);
    await fs.writeFile(stagingPath, encryptedBuffer);

    // Create DB record (no durable key yet)
    const item = await this.prisma.evidenceQueueItem.create({
      data: {
        fileName: file.originalname,
        filePath: stagingPath,
        storageKey: null,
        fileHash,
        fingerprint,
        mimeType: file.mimetype,
        size: file.size,
        ownerId,
        orgId,
        status: EvidenceStatus.pending,
      },
    });

    await this.auditService.record({
      actorId: ownerId,
      entity: 'evidence_queue',
      entityId: item.id,
      action: 'queue_upload',
      metadata: { fileName: file.originalname, size: file.size, orgId },
    });

    // Start upload process asynchronously
    void this.processUpload(item.id);

    return item;
  }

  async processUpload(id: string) {
    const item = await this.prisma.evidenceQueueItem.findUnique({
      where: { id },
    });

    if (!item || item.status === EvidenceStatus.completed) return;
    // Already durably stored (e.g. retried upload that succeeded).
    if (item.storageKey) return;

    this.logger.log(`Processing upload for ${item.id}`);

    await this.prisma.evidenceQueueItem.update({
      where: { id },
      data: { status: EvidenceStatus.uploading },
    });

    try {
      const stagingPath = item.filePath;
      if (!stagingPath) {
        throw new Error('Missing staging file path for evidence upload');
      }

      const encryptedBuffer = await fs.readFile(stagingPath);

      // Upload to the configured StorageDriver. This resolves with a real,
      // retrievable storage key or throws a typed StorageError on failure
      // (never a silent success).
      const storageKey = await this.storageService.upload(
        this.storageService.generateKey(item.orgId),
        encryptedBuffer,
      );

      await this.prisma.evidenceQueueItem.update({
        where: { id },
        data: { status: EvidenceStatus.completed, storageKey },
      });

      // Remove the staging file now that the durable copy exists.
      try {
        await fs.unlink(stagingPath);
      } catch (err) {
        this.logger.warn(
          `Failed to remove staging file ${stagingPath}: ${(err as Error).message}`,
        );
      }

      this.logger.log(
        `Upload completed for ${item.id} (key=${storageKey}, driver=${this.storageService.driverType})`,
      );
    } catch (err) {
      const message =
        err instanceof StorageError
          ? `${err.name}: ${err.message}`
          : (err as Error).message;

      this.logger.error(`Upload failed for ${item.id}: ${message}`);

      await this.prisma.evidenceQueueItem.update({
        where: { id },
        data: {
          status: EvidenceStatus.failed,
          retryCount: { increment: 1 },
          lastError: message,
        },
      });

      // Re-throw so callers (and tests) can assert on the typed failure.
      throw err instanceof StorageError
        ? err
        : new Error(`Evidence upload failed: ${message}`);
    }
  }

  async findQueue(ownerId: string) {
    return this.prisma.evidenceQueueItem.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async retry(id: string, ownerId: string) {
    const item = await this.prisma.evidenceQueueItem.findFirst({
      where: { id, ownerId },
    });

    if (!item) throw new NotFoundException('Queue item not found');

    if (item.status === EvidenceStatus.completed) {
      throw new BadRequestException('Item already uploaded');
    }

    await this.prisma.evidenceQueueItem.update({
      where: { id },
      data: { status: EvidenceStatus.pending },
    });

    void this.processUpload(id);

    return { message: 'Retry initiated' };
  }

  async remove(id: string, ownerId: string) {
    const item = await this.prisma.evidenceQueueItem.findFirst({
      where: { id, ownerId },
    });

    if (!item) throw new NotFoundException('Queue item not found');

    // Delete the durably stored artifact from the StorageDriver, if present.
    if (item.storageKey) {
      try {
        await this.storageService.remove(item.storageKey);
      } catch (err) {
        this.logger.warn(
          `Failed to delete stored artifact ${item.storageKey}: ${(err as Error).message}`,
        );
      }
    }

    // Clean up any remaining staging file.
    if (item.filePath) {
      try {
        await fs.unlink(item.filePath);
      } catch (err) {
        this.logger.warn(
          `Failed to delete staging file ${item.filePath}: ${(err as Error).message}`,
        );
      }
    }

    await this.prisma.evidenceQueueItem.delete({
      where: { id },
    });

    await this.auditService.record({
      actorId: ownerId,
      entity: 'evidence_queue',
      entityId: id,
      action: 'remove_item',
      metadata: { fileName: item.fileName },
    });

    return { message: 'Item removed from queue' };
  }
}

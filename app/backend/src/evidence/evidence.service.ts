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
  ) {
    // Ensure upload directory exists
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

    // Save to disk
    const fileName = `${crypto.randomUUID()}.enc`;
    const filePath = path.join(this.uploadDir, fileName);
    await fs.writeFile(filePath, encryptedBuffer);

    // Create DB record
    const item = await this.prisma.evidenceQueueItem.create({
      data: {
        fileName: file.originalname,
        filePath,
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

    this.logger.log(`Processing upload for ${item.id}`);

    await this.prisma.evidenceQueueItem.update({
      where: { id },
      data: { status: EvidenceStatus.uploading },
    });

    try {
      // MOCK: Simulate upload to S3/Cloud Storage
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Simulate success
      await this.prisma.evidenceQueueItem.update({
        where: { id },
        data: { status: EvidenceStatus.completed },
      });

      this.logger.log(`Upload completed for ${item.id}`);
    } catch (err) {
      this.logger.error(
        `Upload failed for ${item.id}: ${(err as Error).message}`,
      );

      await this.prisma.evidenceQueueItem.update({
        where: { id },
        data: {
          status: EvidenceStatus.failed,
          retryCount: { increment: 1 },
          lastError: (err as Error).message,
        },
      });
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

    // Delete local file if it exists
    if (item.filePath) {
      try {
        await fs.unlink(item.filePath);
      } catch (err) {
        this.logger.warn(
          `Failed to delete file ${item.filePath}: ${(err as Error).message}`,
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

import { Module } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { EvidenceController } from './evidence.controller';
import { ArtifactOwnershipTokenService } from './artifact-ownership-token.service';
import { ArtifactTokenGuard } from '../common/guards/artifact-token.guard';
import { UploadSessionService } from './upload-session.service';
import { UploadSessionController } from './upload-session.controller';
import { UploadSessionStore } from './upload-session.store';
import { PrismaModule } from '../prisma/prisma.module';
import { EncryptionModule } from '../common/encryption/encryption.module';
import { AuditModule } from '../audit/audit.module';
import { CacheModule } from '../common/cache/cache.module';
import { FingerprintService } from './fingerprint.service';
import { MetricsModule } from '../observability/metrics/metrics.module';
import { EvidenceQueueMetricsScheduler } from './evidence-queue-metrics.scheduler';

@Module({
  imports: [PrismaModule, EncryptionModule, AuditModule, CacheModule, MetricsModule],
  controllers: [EvidenceController, UploadSessionController],
  providers: [
    EvidenceService,
    FingerprintService,
    ArtifactOwnershipTokenService,
    ArtifactTokenGuard,
    UploadSessionService,
    UploadSessionStore,
    EvidenceQueueMetricsScheduler,
  ],
  exports: [FingerprintService, ArtifactOwnershipTokenService],
})
export class EvidenceModule {}

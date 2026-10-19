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
import { EvidenceMetricsScheduler } from './evidence-metrics.scheduler';
import { OrphanedArtifactsService } from './orphaned-artifacts.service';
import { OrphanedArtifactsScheduler } from './orphaned-artifacts.scheduler';
import { OrphanedArtifactsController } from './orphaned-artifacts.controller';

@Module({
  imports: [
    PrismaModule,
    EncryptionModule,
    AuditModule,
    CacheModule,
    MetricsModule,
  ],
  controllers: [
    EvidenceController,
    UploadSessionController,
    OrphanedArtifactsController,
  ],
  providers: [
    EvidenceService,
    FingerprintService,
    ArtifactOwnershipTokenService,
    ArtifactTokenGuard,
    UploadSessionService,
    UploadSessionStore,
    EvidenceMetricsScheduler,
    OrphanedArtifactsService,
    OrphanedArtifactsScheduler,
  ],
  exports: [
    FingerprintService,
    ArtifactOwnershipTokenService,
    OrphanedArtifactsService,
  ],
})
export class EvidenceModule {}

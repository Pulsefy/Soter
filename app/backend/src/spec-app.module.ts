import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ReleaseConfigService } from './release-config.service';
import { RedisModule } from './redis/redis.module';
import rateLimitConfig from './config/rate-limit.config';
import { HmacService } from './common/hmac/hmac.service';
import { AidController } from './aid/aid.controller';
import { AidService } from './aid/aid.service';

import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsService } from './analytics/analytics.service';

import { ApiKeysController } from './api-keys/api-keys.controller';
import { ApiKeysService } from './api-keys/api-keys.service';

import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';

import { CampaignsController } from './campaigns/campaigns.controller';
import { CampaignsService } from './campaigns/campaigns.service';
import { CancelAndReissueService } from './claims/cancel-and-reissue.service';
import { BudgetService } from './common/budget/budget.service';

import { ClaimsController } from './claims/claims.controller';
import { ClaimsService } from './claims/claims.service';
import { InternalNotesService } from './common/services/internal-notes.service';
import { SorobanEventCorrelationService } from './onchain/soroban-event-correlation.service';

import { DeploymentMetadataController } from './deployment-metadata/deployment-metadata.controller';
import { DeploymentMetadataService } from './deployment-metadata/deployment-metadata.service';

import { DeviceTokensController } from './device-tokens/device-tokens.controller';
import { DeviceTokensService } from './device-tokens/device-tokens.service';

import { DriftReportController } from './drift-report/drift-report.controller';
import { DriftReportService } from './drift-report/drift-report.service';

import { EntityLinkingController } from './entity-linking/entity-linking.controller';
import { EntityLinkingService } from './entity-linking/entity-linking.service';

import { EvidenceController } from './evidence/evidence.controller';
import { EvidenceService } from './evidence/evidence.service';
import { ArtifactOwnershipTokenService } from './evidence/artifact-ownership-token.service';
import { UploadSessionController } from './evidence/upload-session.controller';
import { UploadSessionService } from './evidence/upload-session.service';

import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { MetadataService } from './health/metadata.service';

import { JobsController } from './jobs/jobs.controller';
import { DlqService } from './jobs/dlq.service';
import { JobStatusStreamingController } from './jobs/controllers/job-status-streaming.controller';
import { JobStatusBroadcaster } from './jobs/services/job-status-broadcaster.service';

import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { OutboxController } from './notifications/outbox.controller';

import { ObservabilityController } from './observability/observability.controller';
import { ObservabilityService } from './observability/observability.service';
import { HealthController as ObservabilityHealthController } from './observability/health/health.controller';
import { HealthService as ObservabilityHealthService } from './observability/health/health.service';
import { MetricsController } from './observability/metrics/metrics.controller';

import { AidEscrowController } from './onchain/aid-escrow.controller';
import { AidEscrowService } from './onchain/aid-escrow.service';
import { LedgerAdminController } from './onchain/ledger-admin.controller';
import { LedgerBackfillService } from './onchain/ledger-backfill.service';
import { LedgerReconciliationService } from './onchain/ledger-reconciliation.service';

import { InvitesController } from './orgs/invites.controller';
import { InvitesService } from './orgs/invites.service';

import { RecipientImportController } from './recipient-import/recipient-import.controller';
import { RecipientImportService } from './recipient-import/recipient-import.service';

import { RecipientsController } from './recipients/recipients.controller';
import { RecipientsService } from './recipients/recipients.service';

import { ReleaseConfigController } from './release-config/release-config.controller';
import { PrismaService } from './prisma/prisma.service';

import { RetentionPolicyController } from './retention-policy/retention-policy.controller';
import { RetentionPolicyService } from './retention-policy/retention-policy.service';

import { SandboxController } from './sandbox/sandbox.controller';
import { SandboxService } from './sandbox/sandbox.service';

import { AdminSearchController } from './search/admin-search.controller';
import { AdminSearchService } from './search/admin-search.service';

import { SessionController } from './session/session.controller';
import { SessionService } from './session/session.service';

import { TestErrorController } from './test-error/test-error.controller';

import { VerificationController } from './verification/verification.controller';
import { VerificationService } from './verification/verification.service';
import { VerificationFlowService } from './verification/verification-flow.service';
import { VerificationInboxController } from './verification/verification-inbox.controller';
import { VerificationInboxService } from './verification/verification-inbox.service';
import { ReviewLockService } from './verification/review-lock.service';
import { VerificationInboxSseController } from './verification/verification-inbox-sse.controller';
import { VerificationInboxEventsService } from './verification/verification-inbox-events.service';

import { WebhooksController } from './webhooks.controller';

const stub = <T>(value: T) => ({ useValue: value });

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [rateLimitConfig],
    }),
    RedisModule,
  ],
  controllers: [
    AppController,
    AidController,
    AnalyticsController,
    ApiKeysController,
    AuditController,
    CampaignsController,
    ClaimsController,
    DeploymentMetadataController,
    DeviceTokensController,
    DriftReportController,
    EntityLinkingController,
    EvidenceController,
    UploadSessionController,
    HealthController,
    JobsController,
    JobStatusStreamingController,
    NotificationsController,
    OutboxController,
    ObservabilityController,
    ObservabilityHealthController,
    MetricsController,
    AidEscrowController,
    LedgerAdminController,
    InvitesController,
    RecipientImportController,
    RecipientsController,
    ReleaseConfigController,
    RetentionPolicyController,
    SandboxController,
    AdminSearchController,
    SessionController,
    TestErrorController,
    VerificationController,
    VerificationInboxController,
    VerificationInboxSseController,
    WebhooksController,
  ],
  providers: [
    { provide: AppService, ...stub({}) },
    { provide: ReleaseConfigService, ...stub({ get: () => ({}) }) },
    { provide: AidService, ...stub({}) },
    { provide: AnalyticsService, ...stub({}) },
    { provide: ApiKeysService, ...stub({}) },
    { provide: AuditService, ...stub({}) },
    { provide: CampaignsService, ...stub({}) },
    { provide: CancelAndReissueService, ...stub({}) },
    { provide: BudgetService, ...stub({}) },
    { provide: ClaimsService, ...stub({}) },
    { provide: InternalNotesService, ...stub({}) },
    { provide: SorobanEventCorrelationService, ...stub({}) },
    { provide: DeploymentMetadataService, ...stub({}) },
    { provide: DeviceTokensService, ...stub({}) },
    { provide: DriftReportService, ...stub({}) },
    { provide: EntityLinkingService, ...stub({}) },
    { provide: EvidenceService, ...stub({}) },
    { provide: ArtifactOwnershipTokenService, ...stub({}) },
    { provide: UploadSessionService, ...stub({}) },
    { provide: HealthService, ...stub({}) },
    { provide: MetadataService, ...stub({}) },
    { provide: DlqService, ...stub({}) },
    { provide: JobStatusBroadcaster, ...stub({}) },
    { provide: NotificationsService, ...stub({}) },
    { provide: ObservabilityService, ...stub({}) },
    { provide: ObservabilityHealthService, ...stub({}) },
    { provide: AidEscrowService, ...stub({}) },
    { provide: LedgerBackfillService, ...stub({}) },
    { provide: LedgerReconciliationService, ...stub({}) },
    { provide: InvitesService, ...stub({}) },
    { provide: RecipientImportService, ...stub({}) },
    { provide: RecipientsService, ...stub({}) },
    { provide: RetentionPolicyService, ...stub({}) },
    { provide: SandboxService, ...stub({}) },
    { provide: AdminSearchService, ...stub({}) },
    { provide: SessionService, ...stub({}) },
    { provide: VerificationService, ...stub({}) },
    { provide: VerificationFlowService, ...stub({}) },
    { provide: VerificationInboxService, ...stub({}) },
    { provide: ReviewLockService, ...stub({}) },
    { provide: VerificationInboxEventsService, ...stub({}) },
    { provide: ConfigService, ...stub({ get: () => undefined, getOrThrow: () => 'spec-only-secret' }) },
    { provide: PrismaService, ...stub({}) },
    { provide: HmacService, ...stub({ sign: () => 'spec-only-signature', verify: () => true }) },
  ],
})
export class SpecAppModule {}

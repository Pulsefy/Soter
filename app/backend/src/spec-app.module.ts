/* eslint-disable */
/**
 * Minimal NestJS module for OpenAPI specification generation only.
 * This module is used exclusively by the spec generation and drift check scripts
 * to avoid booting the full application with all its runtime dependencies.
 * Linting is disabled because this module contains many stub providers and
 * imports that are necessary for metadata collection but not for actual runtime use.
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { ReleaseConfigService } from '../src/release-config.service';
import { RedisModule } from '../src/redis/redis.module';
import rateLimitConfig from '../src/config/rate-limit.config';
import { HmacService } from '../src/common/hmac/hmac.service';
import { AidController } from '../src/aid/aid.controller';
import { AidService } from '../src/aid/aid.service';

import { AnalyticsController } from '../src/analytics/analytics.controller';
import { AnalyticsService } from '../src/analytics/analytics.service';

import { ApiKeysController } from '../src/api-keys/api-keys.controller';
import { ApiKeysService } from '../src/api-keys/api-keys.service';

import { AuditController } from '../src/audit/audit.controller';
import { AuditService } from '../src/audit/audit.service';

import { CampaignsController } from '../src/campaigns/campaigns.controller';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { CancelAndReissueService } from '../src/claims/cancel-and-reissue.service';
import { BudgetService } from '../src/common/budget/budget.service';

import { ClaimsController } from '../src/claims/claims.controller';
import { ClaimsService } from '../src/claims/claims.service';
import { InternalNotesService } from '../src/common/services/internal-notes.service';
import { SorobanEventCorrelationService } from '../src/onchain/soroban-event-correlation.service';

import { DeploymentMetadataController } from '../src/deployment-metadata/deployment-metadata.controller';
import { DeploymentMetadataService } from '../src/deployment-metadata/deployment-metadata.service';

import { DeviceTokensController } from '../src/device-tokens/device-tokens.controller';
import { DeviceTokensService } from '../src/device-tokens/device-tokens.service';

import { DriftReportController } from '../src/drift-report/drift-report.controller';
import { DriftReportService } from '../src/drift-report/drift-report.service';

import { EntityLinkingController } from '../src/entity-linking/entity-linking.controller';
import { EntityLinkingService } from '../src/entity-linking/entity-linking.service';

import { EvidenceController } from '../src/evidence/evidence.controller';
import { EvidenceService } from '../src/evidence/evidence.service';
import { ArtifactOwnershipTokenService } from '../src/evidence/artifact-ownership-token.service';
import { UploadSessionController } from '../src/evidence/upload-session.controller';
import { UploadSessionService } from '../src/evidence/upload-session.service';

import { HealthController } from '../src/health/health.controller';
import { HealthService } from '../src/health/health.service';
import { MetadataService } from '../src/health/metadata.service';

import { JobsController } from '../src/jobs/jobs.controller';
import { DlqService } from '../src/jobs/dlq.service';
import { JobStatusStreamingController } from '../src/jobs/controllers/job-status-streaming.controller';
import { JobStatusBroadcaster } from '../src/jobs/services/job-status-broadcaster.service';

import { NotificationsController } from '../src/notifications/notifications.controller';
import { NotificationsService } from '../src/notifications/notifications.service';
import { OutboxController } from '../src/notifications/outbox.controller';

import { ObservabilityController } from '../src/observability/observability.controller';
import { ObservabilityService } from '../src/observability/observability.service';
import { HealthController as ObservabilityHealthController } from '../src/observability/health/health.controller';
import { HealthService as ObservabilityHealthService } from '../src/observability/health/health.service';
import { MetricsController } from '../src/observability/metrics/metrics.controller';

import { AidEscrowController } from '../src/onchain/aid-escrow.controller';
import { AidEscrowService } from '../src/onchain/aid-escrow.service';
import { LedgerAdminController } from '../src/onchain/ledger-admin.controller';
import { LedgerBackfillService } from '../src/onchain/ledger-backfill.service';
import { LedgerReconciliationService } from '../src/onchain/ledger-reconciliation.service';

import { InvitesController } from '../src/orgs/invites.controller';
import { InvitesService } from '../src/orgs/invites.service';

import { RecipientImportController } from '../src/recipient-import/recipient-import.controller';
import { RecipientImportService } from '../src/recipient-import/recipient-import.service';

import { RecipientsController } from '../src/recipients/recipients.controller';
import { RecipientsService } from '../src/recipients/recipients.service';

import { ReleaseConfigController } from '../src/release-config/release-config.controller';
import { PrismaService } from '../src/prisma/prisma.service';

import { RetentionPolicyController } from '../src/retention-policy/retention-policy.controller';
import { RetentionPolicyService } from '../src/retention-policy/retention-policy.service';

import { SandboxController } from '../src/sandbox/sandbox.controller';
import { SandboxService } from '../src/sandbox/sandbox.service';

import { AdminSearchController } from '../src/search/admin-search.controller';
import { AdminSearchService } from '../src/search/admin-search.service';

import { SessionController } from '../src/session/session.controller';
import { SessionService } from '../src/session/session.service';

import { TestErrorController } from '../src/test-error/test-error.controller';

import { VerificationController } from '../src/verification/verification.controller';
import { VerificationService } from '../src/verification/verification.service';
import { VerificationFlowService } from '../src/verification/verification-flow.service';
import { VerificationInboxController } from '../src/verification/verification-inbox.controller';
import { VerificationInboxService } from '../src/verification/verification-inbox.service';
import { ReviewLockService } from '../src/verification/review-lock.service';
import { VerificationInboxSseController } from '../src/verification/verification-inbox-sse.controller';
import { VerificationInboxEventsService } from '../src/verification/verification-inbox-events.service';

import { WebhooksController } from '../src/webhooks.controller';

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
    {
      provide: ConfigService,
      ...stub({ get: () => undefined, getOrThrow: () => 'spec-only-secret' }),
    },
    { provide: PrismaService, ...stub({}) },
    {
      provide: HmacService,
      ...stub({ sign: () => 'spec-only-signature', verify: () => true }),
    },
  ],
})
export class SpecAppModule {}

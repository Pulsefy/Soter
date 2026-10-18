import { Module } from '@nestjs/common';

import { MetricsModule } from '../observability/metrics/metrics.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ClaimVerificationReconciliationService } from './claim-verification-reconciliation.service';
import { ClaimVerificationStateService } from './claim-verification-state.service';

/**
 * Claim/verification consistency.
 *
 * Provides the single source of truth for whether a claim's verification is
 * complete, and the scheduled job that reports claims whose status disagrees
 * with their verification record. Registered from `AppModule` next to
 * `ClaimsModule`: the reconciliation is a background job, not part of the
 * claims HTTP surface.
 */
@Module({
  imports: [PrismaModule, MetricsModule],
  providers: [
    ClaimVerificationStateService,
    ClaimVerificationReconciliationService,
  ],
  exports: [
    ClaimVerificationStateService,
    ClaimVerificationReconciliationService,
  ],
})
export class ClaimVerificationModule {}

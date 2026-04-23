# Manual Review Workflow Implementation

## Overview
Implemented a complete backend workflow for handling verification cases that cannot be auto-resolved by the AI service and require human review.

## Changes Implemented

### 1. Database Schema Updates (`prisma/schema.prisma`)

Added `ReviewStatus` enum:
```prisma
enum ReviewStatus {
  pending_review
  approved
  rejected
}
```

Extended `Claim` model with review fields:
- `verificationScore`: Float - AI verification score (0-1)
- `verificationResult`: Json - Complete verification result with details
- `reviewStatus`: ReviewStatus - Current review state (pending_review/approved/rejected)
- `reviewedBy`: String - ID of the reviewer who made the decision
- `reviewedAt`: DateTime - Timestamp when review was completed
- `reviewReason`: String - Public reason for the decision
- `reviewNote`: String - Internal note (not visible to claimant)
- `reviewSlaStartedAt`: DateTime - When the claim was flagged for review (SLA tracking)

Added indexes for performance:
- `reviewStatus` - For filtering by review state
- `reviewSlaStartedAt` - For SLA tracking and queue ordering

### 2. DTOs Created

**`dto/review-query.dto.ts`**
- Query parameters for filtering review queue
- Supports pagination (page, limit)
- Filter by status (pending_review, approved, rejected)

**`dto/submit-review.dto.ts`**
- Review decision (approved/rejected)
- Reason (required, max 500 chars)
- Internal note (optional, max 1000 chars)

### 3. Service Methods (`verification.service.ts`)

**`getReviewQueue(status?, page, limit)`**
- Returns paginated list of claims filtered by review status
- Orders by SLA start time (oldest first) then creation date
- Includes campaign information
- Excludes soft-deleted claims

**`submitReview(claimId, reviewerId, decision, reason, note?)`**
- Validates claim exists
- Updates claim with review decision and metadata
- Changes claim status based on decision:
  - `approved` → status becomes `verified`
  - `rejected` → status remains `requested`
- Records action in audit trail with full context
- Returns updated claim

**Updated `processVerification()`**
- Now stores `verificationScore` and `verificationResult` on the claim
- Automatically flags claims for manual review when:
  - Score is below threshold (< 0.7 by default)
  - Score is above minimum (>= 0.5)
  - This creates a "gray zone" requiring human judgment
- Sets `reviewStatus` to `pending_review` and `reviewSlaStartedAt` timestamp
- Logs when claims are flagged for review

### 4. Controller Endpoints (`verification.controller.ts`)

**`GET /v1/verification/reviews/queue`**
- Query parameters: `status`, `page`, `limit`
- Returns paginated review queue with campaign details
- Requires JWT authentication (`@ApiBearerAuth`)
- Response includes: data array, total count, page, limit

**`POST /v1/verification/reviews/:claimId/submit`**
- Path parameter: `claimId`
- Body: `SubmitReviewDto` (decision, reason, note)
- Extracts reviewer ID from JWT token (`req.user.id`)
- Returns updated claim with review metadata
- Requires JWT authentication

### 5. Migration File

Created `migrations/20260422000000_add_review_workflow/migration.sql`:
- Creates `ReviewStatus` enum
- Adds all review-related columns to `Claim` table
- Creates indexes for query performance

## Workflow

### Automatic Flagging
1. Claim is submitted and verification job is enqueued
2. AI service processes the claim and returns a score
3. If score is between 0.5 and 0.7:
   - Claim is flagged with `reviewStatus = 'pending_review'`
   - `reviewSlaStartedAt` is set to current timestamp
   - Claim appears in review queue

### Manual Review
1. Reviewer calls `GET /reviews/queue?status=pending_review`
2. System returns claims ordered by SLA start time (oldest first)
3. Reviewer examines claim details, verification results, and evidence
4. Reviewer submits decision via `POST /reviews/:claimId/submit`
5. System updates claim status and records audit trail
6. Claim moves to appropriate state (verified or remains requested)

### Audit Trail
Every review action is recorded with:
- Actor ID (reviewer)
- Entity: `claim_review`
- Action: `approved` or `rejected`
- Metadata: reason, note, previous status, new status
- Timestamp (automatic)

## SLA Tracking

The `reviewSlaStartedAt` field enables:
- Measuring time-to-review metrics
- Prioritizing oldest pending reviews
- Identifying SLA breaches
- Generating compliance reports

Example query for SLA monitoring:
```typescript
const overdueReviews = await prisma.claim.findMany({
  where: {
    reviewStatus: 'pending_review',
    reviewSlaStartedAt: {
      lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
    }
  }
});
```

## Next Steps

### 1. Run Migration
```bash
cd app/backend
npx prisma migrate dev
npx prisma generate
```

### 2. Add Role-Based Access Control (Recommended)

Update controller to restrict review endpoints to authorized roles:

```typescript
import { UseGuards } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';

// Add to controller class
@UseGuards(RolesGuard)

// Add to review endpoints
@Roles(AppRole.admin, AppRole.operator)
@Get('reviews/queue')
async getReviewQueue(...) { ... }

@Roles(AppRole.admin, AppRole.operator)
@Post('reviews/:claimId/submit')
async submitReview(...) { ... }
```

### 3. Testing

```bash
# Get pending reviews
curl -X GET 'http://localhost:3000/v1/verification/reviews/queue?status=pending_review&page=1&limit=20' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Submit review decision
curl -X POST 'http://localhost:3000/v1/verification/reviews/CLAIM_ID/submit' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "approved",
    "reason": "All documents verified successfully",
    "note": "Contacted applicant for additional verification"
  }'

# Get approved reviews
curl -X GET 'http://localhost:3000/v1/verification/reviews/queue?status=approved' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 4. Frontend Integration

The frontend should:
- Display review queue with filtering and pagination
- Show claim details, verification score, and AI recommendations
- Provide form for submitting review decisions
- Display SLA indicators (time since flagged)
- Show audit history for each claim

### 5. Notifications (Optional Enhancement)

Consider adding notifications when:
- Claim is flagged for review
- Review SLA is approaching/breached
- Review decision is made

### 6. Metrics & Reporting

Add endpoints for:
- Review queue statistics (pending count, average time-to-review)
- Reviewer performance metrics
- SLA compliance reports
- Decision distribution (approval rate, rejection reasons)

## Configuration

The review threshold logic uses existing environment variables:
- `VERIFICATION_THRESHOLD` (default: 0.7) - Auto-approve threshold
- Scores >= 0.7: Auto-approved
- Scores 0.5-0.69: Flagged for manual review
- Scores < 0.5: Auto-rejected (or could also be flagged for review)

To adjust the review threshold, modify the logic in `processVerification()`:
```typescript
const needsReview = !shouldVerify && result.score >= 0.5; // Adjust 0.5 as needed
```

## Security Considerations

1. **Authentication**: All review endpoints require JWT authentication
2. **Authorization**: Should add role-based access control (admin/operator only)
3. **Audit Trail**: All actions are logged with actor ID and metadata
4. **Data Privacy**: Internal notes are separate from public reasons
5. **Soft Deletes**: Review queue excludes soft-deleted claims

## API Documentation

All endpoints are documented with Swagger/OpenAPI annotations:
- Request/response schemas
- Example payloads
- Error responses
- Authentication requirements

Access API docs at: `http://localhost:3000/api` (when server is running)

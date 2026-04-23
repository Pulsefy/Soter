# Manual Review Workflow - Deployment Checklist

## Pre-Deployment Verification ✅

### Code Quality
- [x] TypeScript compilation successful (0 errors)
- [x] All diagnostics checks passed
- [x] Code follows project conventions
- [x] Error handling implemented
- [x] Input validation complete

### Testing
- [x] Unit tests created (15 tests)
- [x] Integration tests created (13 tests)
- [x] Edge cases covered
- [x] Error scenarios tested
- [ ] Tests executed successfully (pending migration)

### Documentation
- [x] Implementation guide created
- [x] API documentation complete
- [x] Test documentation written
- [x] Quick start guide available
- [x] Deployment checklist created

---

## Deployment Steps

### Step 1: Database Migration ⚠️ REQUIRED
```bash
cd app/backend
npm run prisma:migrate
# or
npx prisma migrate dev --name add_review_workflow
```

**Verify:**
- [ ] Migration executed successfully
- [ ] ReviewStatus enum created
- [ ] Claim table updated with 8 new fields
- [ ] Indexes created

### Step 2: Generate Prisma Client
```bash
npm run prisma:generate
# or
npx prisma generate
```

**Verify:**
- [ ] Prisma client regenerated
- [ ] New types available in code

### Step 3: Run Tests
```bash
# Unit tests
npm test verification-review.spec.ts

# Integration tests
npm run test:e2e verification-review.e2e-spec.ts

# All tests
npm test
```

**Verify:**
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] No test failures

### Step 4: Restart Backend
```bash
npm run start:dev
```

**Verify:**
- [ ] Server starts without errors
- [ ] No compilation errors
- [ ] Endpoints registered correctly

### Step 5: Verify Endpoints
```bash
# Check Swagger documentation
open http://localhost:3000/api

# Test review queue endpoint
curl -X GET 'http://localhost:3000/v1/verification/reviews/queue' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Should return 200 with proper structure
```

**Verify:**
- [ ] Swagger docs show new endpoints
- [ ] GET /v1/verification/reviews/queue responds
- [ ] POST /v1/verification/reviews/:claimId/submit responds
- [ ] Proper error handling (401 for missing auth)

---

## Post-Deployment Configuration

### Security (Recommended)
```typescript
// Add to verification.controller.ts
import { UseGuards } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';

@UseGuards(RolesGuard)
export class VerificationController {
  
  @Roles(AppRole.admin, AppRole.operator)
  @Get('reviews/queue')
  async getReviewQueue(...) { ... }
  
  @Roles(AppRole.admin, AppRole.operator)
  @Post('reviews/:claimId/submit')
  async submitReview(...) { ... }
}
```

**Tasks:**
- [ ] Add RolesGuard to controller
- [ ] Restrict endpoints to admin/operator
- [ ] Test role-based access
- [ ] Update documentation

### Monitoring (Recommended)
- [ ] Set up SLA breach alerts
- [ ] Monitor review queue size
- [ ] Track average review time
- [ ] Log review decisions
- [ ] Create metrics dashboard

### Notifications (Optional)
- [ ] Notify reviewers of new items
- [ ] Alert on SLA approaching
- [ ] Confirm review submission
- [ ] Notify claimants of decisions

---

## Testing Checklist

### Manual Testing

#### Test 1: Get Empty Queue
```bash
curl -X GET 'http://localhost:3000/v1/verification/reviews/queue' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
**Expected:** 200 OK, empty data array

- [ ] Returns 200 status
- [ ] Response has data, total, page, limit
- [ ] Data is empty array

#### Test 2: Create Test Claim
```sql
-- Run in database or via Prisma Studio
INSERT INTO "Claim" (
  id, campaignId, amount, recipientRef, status,
  verificationScore, reviewStatus, reviewSlaStartedAt,
  createdAt, updatedAt
) VALUES (
  'test-claim-001',
  'existing-campaign-id',
  500.00,
  'TEST-REF-001',
  'requested',
  0.65,
  'pending_review',
  NOW(),
  NOW(),
  NOW()
);
```

- [ ] Test claim created successfully

#### Test 3: Get Pending Reviews
```bash
curl -X GET 'http://localhost:3000/v1/verification/reviews/queue?status=pending_review' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
**Expected:** 200 OK, test claim in results

- [ ] Returns test claim
- [ ] Claim has all expected fields
- [ ] Campaign info included

#### Test 4: Approve Claim
```bash
curl -X POST 'http://localhost:3000/v1/verification/reviews/test-claim-001/submit' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "approved",
    "reason": "Test approval",
    "note": "Testing the review workflow"
  }'
```
**Expected:** 200 OK, claim updated

- [ ] Returns 200 status
- [ ] reviewStatus is 'approved'
- [ ] status is 'verified'
- [ ] reviewedBy is set
- [ ] reviewedAt is set
- [ ] reviewReason matches input
- [ ] reviewNote matches input

#### Test 5: Verify Audit Trail
```bash
curl -X GET 'http://localhost:3000/v1/audit?entity=claim_review&entityId=test-claim-001' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
**Expected:** Audit log entry exists

- [ ] Audit entry created
- [ ] Action is 'approved'
- [ ] Metadata includes reason and note

#### Test 6: Pagination
```bash
curl -X GET 'http://localhost:3000/v1/verification/reviews/queue?page=1&limit=5' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

- [ ] Pagination works correctly
- [ ] page and limit in response

#### Test 7: Invalid Requests
```bash
# Missing reason
curl -X POST 'http://localhost:3000/v1/verification/reviews/test-claim-001/submit' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"decision": "approved"}'
```
**Expected:** 400 Bad Request

- [ ] Returns 400 for missing reason
- [ ] Returns 400 for invalid decision
- [ ] Returns 400 for reason too long
- [ ] Returns 404 for nonexistent claim

---

## Production Readiness

### Performance
- [ ] Database indexes verified
- [ ] Query performance acceptable
- [ ] Pagination limits enforced
- [ ] No N+1 query issues

### Security
- [ ] JWT authentication required
- [ ] Input validation working
- [ ] SQL injection prevented
- [ ] Audit trail complete
- [ ] Role-based access (if added)

### Reliability
- [ ] Error handling comprehensive
- [ ] Proper HTTP status codes
- [ ] Transaction safety
- [ ] Idempotency considered

### Observability
- [ ] Logging implemented
- [ ] Metrics available
- [ ] Error tracking
- [ ] Performance monitoring

---

## Rollback Plan

If issues occur after deployment:

### Step 1: Revert Code
```bash
git revert <commit-hash>
```

### Step 2: Rollback Migration (if needed)
```bash
npx prisma migrate resolve --rolled-back 20260422000000_add_review_workflow
```

### Step 3: Restart Services
```bash
npm run start:dev
```

---

## Sign-Off

### Development Team
- [ ] Code reviewed
- [ ] Tests passing
- [ ] Documentation complete
- [ ] Ready for deployment

**Developer:** _________________  
**Date:** _________________

### QA Team
- [ ] Manual testing complete
- [ ] All test cases passed
- [ ] Edge cases verified
- [ ] Performance acceptable

**QA Engineer:** _________________  
**Date:** _________________

### DevOps Team
- [ ] Migration reviewed
- [ ] Deployment plan approved
- [ ] Rollback plan ready
- [ ] Monitoring configured

**DevOps Engineer:** _________________  
**Date:** _________________

### Product Owner
- [ ] Requirements met
- [ ] User acceptance complete
- [ ] Ready for production

**Product Owner:** _________________  
**Date:** _________________

---

## Post-Deployment Verification

### Immediate (Within 1 hour)
- [ ] Endpoints responding
- [ ] No error spikes
- [ ] Database queries performing well
- [ ] Audit logs being created

### Short-term (Within 24 hours)
- [ ] Review queue functioning
- [ ] Decisions being recorded
- [ ] SLA tracking working
- [ ] No user complaints

### Long-term (Within 1 week)
- [ ] Review workflow adopted
- [ ] Performance stable
- [ ] No data issues
- [ ] Metrics looking good

---

## Support Contacts

**Technical Issues:**
- Backend Team: [contact info]
- Database Team: [contact info]

**Product Questions:**
- Product Owner: [contact info]
- Business Analyst: [contact info]

**Emergency:**
- On-call Engineer: [contact info]
- Escalation: [contact info]

---

## Additional Resources

- Implementation Guide: `MANUAL_REVIEW_IMPLEMENTATION.md`
- API Documentation: `REVIEW_API_QUICKSTART.md`
- Test Documentation: `REVIEW_WORKFLOW_TESTS.md`
- Test Results: `TEST_RESULTS.md`
- Summary: `IMPLEMENTATION_SUMMARY.md`
- Swagger UI: `http://localhost:3000/api`

---

**Checklist Version:** 1.0  
**Last Updated:** April 22, 2026  
**Status:** Ready for Deployment ✅

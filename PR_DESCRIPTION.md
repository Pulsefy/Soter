# Pull Request Description

## 🎯 **Overview**
Implements automated cron-based claim expiration handler to clean up expired claims and update contract/database state when a claim's `expiresAt` passes.

## 📋 **Issue Reference**
Fixes #218 - Cron-based Automated Claim Expiration Handler

## 🚀 **Features Implemented**

### Database Schema Updates
- ✅ Added `expiresAt` field to Claim model for expiration tracking
- ✅ Added `expired` status to ClaimStatus enum
- ✅ Added database index on `expiresAt` for efficient querying

### Cron Job Implementation
- ✅ Hourly automated cleanup using `@Cron(CronExpression.EVERY_HOUR)`
- ✅ Identifies claims where `expiresAt < now` and status is `requested` or `verified`
- ✅ Updates claim status to `expired` with transactional safety
- ✅ Comprehensive error handling and logging

### On-chain Integration
- ✅ Extended `OnchainAdapter` with `revokeAidPackage` and `refundAidPackage` methods
- ✅ Smart logic based on claim status:
  - `requested` claims → revoke operation
  - `verified` claims → refund operation
- ✅ Resilient design - continues database updates even if on-chain operations fail

### Audit & Monitoring
- ✅ Full audit trail via `AuditService` for all expiration operations
- ✅ Metrics tracking for processed/failed claims
- ✅ Performance monitoring for on-chain operations
- ✅ Structured logging for debugging and compliance

### API Support
- ✅ Updated `CreateClaimDto` to include optional `expiresAt` field
- ✅ Backward compatible with existing claim creation flow
- ✅ Added `@nestjs/schedule` dependency and module integration

## 🛠 **Technical Details**

### Files Changed
- `prisma/schema.prisma` - Database schema updates
- `package.json` - Added @nestjs/schedule dependency
- `src/app.module.ts` - ScheduleModule integration
- `src/claims/claims.service.ts` - Core cron job implementation
- `src/claims/dto/create-claim.dto.ts` - API support for expiresAt
- `src/onchain/onchain.adapter.ts` - On-chain interface extensions

### Configuration
- Cron job runs every hour automatically
- Configurable via environment variables:
  - `ONCHAIN_ENABLED` - Enable/disable on-chain operations
  - `ONCHAIN_ADAPTER` - Adapter type (mock/stellar)
  - `ONCHAIN_OPERATOR_ADDRESS` - Operator address for revoke/refund

### Error Handling
- Individual claim failures don't stop batch processing
- Comprehensive logging for debugging
- Graceful degradation when on-chain services unavailable
- Transactional database operations for data consistency

## 🧪 **Testing Notes**

After merging:
1. Run `prisma migrate dev` to apply schema changes
2. Create test claims with `expiresAt` in the past
3. Verify cron job processes them to `expired` status
4. Check audit logs for proper recording
5. Monitor metrics for claim processing counts

## 🔒 **Security & Compliance**

- All operations are audited with actor ID 'system'
- Sensitive data remains encrypted (recipientRef)
- On-chain operations use dedicated operator address
- Comprehensive logging for regulatory compliance

## 📈 **Performance Impact**

- Minimal performance overhead (runs hourly)
- Efficient database queries using indexes
- Batch processing with Promise.allSettled
- Non-blocking on-chain operations

This implementation provides a robust, production-ready solution for automated claim expiration handling that meets all requirements from issue #218.

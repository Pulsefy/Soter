# Sync Deferral with Battery and Network Awareness

## Overview

This implementation adds battery and network awareness to the background sync system in Soter. The sync queue now defers operations under certain conditions to preserve battery life and avoid expensive data usage on metered connections.

## Features

### 1. Battery-Aware Sync Deferral
- Sync operations are deferred when battery level falls below a configurable threshold (default: 20%)
- Deferral is bypassed when the device is charging
- Configurable via `EXPO_PUBLIC_BATTERY_THRESHOLD` environment variable

### 2. Network-Aware Sync Deferral
- Large uploads (>5MB by default) are deferred on metered connections unless user opts in
- All sync operations can be deferred on metered connections based on configuration
- User can opt-in to allow sync on metered connections via UI
- Configurable via:
  - `EXPO_PUBLIC_LARGE_UPLOAD_THRESHOLD` (default: 5MB)
  - `EXPO_PUBLIC_ALLOW_METERED_SYNC` (default: false)

### 3. Urgent Item Bypass
- Urgent sync items bypass most deferral rules
- Urgent items still respect critical battery levels to preserve device functionality
- Mark items as urgent by setting `urgent: true` in the payload

### 4. Force Sync Override
- Users can force sync to bypass all deferral rules temporarily
- Force sync override automatically clears after 5 minutes
- Available via "Force Sync" button in the Submission Queue screen

### 5. Diagnostic Logging
- All deferral decisions are logged with timestamps and reasons
- Deferral history is stored in the sync action metadata
- Users can view deferral reasons in the Submission Queue inspection modal

## Architecture

### New Components

#### SyncDeferralContext
A new React context that provides:
- Real-time battery level monitoring
- Network connection type detection (metered vs unmetered)
- User preferences for metered connection sync
- Force sync override state
- Deferral decision logic

#### Enhanced SyncQueue
- Added `deferralReason` and `deferralLog` fields to `QueuedSyncAction`
- Enhanced `flushPendingNetworkActions` to accept battery/network parameters
- Automatic deferral logging with timestamps

#### Updated UI Components
- SubmissionQueueScreen now displays deferral status
- Added "Force Sync" button when sync is deferred
- Added metered connection opt-in toggle
- Enhanced inspection modal to show deferral information

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Battery threshold (0-1, default: 0.2 for 20%)
EXPO_PUBLIC_BATTERY_THRESHOLD=0.2

# Large upload threshold in bytes (default: 5242880 for 5MB)
EXPO_PUBLIC_LARGE_UPLOAD_THRESHOLD=5242880

# Allow sync on metered connections without user opt-in (default: false)
EXPO_PUBLIC_ALLOW_METERED_SYNC=false
```

### Deferral Rules

#### Low Battery Deferral
- **Condition**: Battery level < threshold AND not charging
- **Applies to**: All sync operations
- **Bypass**: Charging state, force sync override
- **Urgent items**: Still deferred (critical battery protection)

#### Metered Connection Deferral
- **Condition**: Metered connection AND user opt-in disabled
- **Applies to**: All sync operations
- **Bypass**: User opt-in, force sync override
- **Urgent items**: Bypassed (unless large upload)

#### Large Upload Deferral
- **Condition**: Metered connection AND upload size > threshold AND user opt-in disabled
- **Applies to**: Evidence uploads
- **Bypass**: User opt-in, force sync override
- **Urgent items**: Bypassed

## API Usage

### Marking Items as Urgent

```typescript
// Status refresh
await syncContext.queueStatusRefresh(aidId, true); // urgent

// Claim confirmation
await syncContext.queueClaimConfirmation(aidId, claimId, true); // urgent

// Evidence upload with size estimation
await syncContext.queueEvidenceUpload(aidId, {
  url: uploadUrl,
  body: requestBody,
  estimatedSize: 10 * 1024 * 1024, // 10MB
}, false); // not urgent

// Claim submission
await syncContext.queueClaimSubmission(aidId, claimId, idempotencyKey, true); // urgent
```

### Using Force Sync

```typescript
// Force sync to bypass all deferrals
await syncContext.forceSync();
```

### Checking Deferral Status

```typescript
const { deferralStatus, deferralExplanation } = useSync();

if (deferralStatus?.deferred) {
  console.log('Sync deferred:', deferralExplanation);
}
```

### Accessing Battery/Network State

```typescript
const { 
  batteryLevel, 
  isCharging, 
  isMetered, 
  meteredOptIn,
  setMeteredOptIn,
  shouldDeferAction 
} = useSyncDeferral();

// Check if an action should be deferred
const { deferred, reason } = shouldDeferAction('evidence-upload', false);

// Toggle metered sync preference
await setMeteredOptIn(true);
```

## Diagnostic Information

### Viewing Deferral Reasons

1. Navigate to the Submission Queue screen
2. Click "Inspect Details" on any queued item
3. Deferral information is shown in the "Deferral Information" section
4. Includes deferral reason and timestamped log entries

### Deferral Log Format

```
[2026-08-25T14:15:30.123Z] Deferred: low-battery - Battery at 15%, threshold 20%
[2026-08-25T14:20:45.456Z] Deferred: large-upload - Upload size 6MB on metered connection
```

## Testing

The implementation includes unit tests for the core deferral logic:

```bash
npm test -- syncDeferral.test.ts
```

## Migration Notes

### Existing Code Compatibility

The implementation is backward compatible:
- Existing sync operations work without modification
- New optional parameters (`urgent`, `estimatedSize`) default to safe values
- Missing environment variables use sensible defaults

### Required Updates

1. **Add expo-battery dependency** (already added to package.json)
2. **Wrap app with SyncDeferralProvider** (already done in App.tsx)
3. **Set environment variables** (optional, defaults provided)

## Performance Considerations

- Battery monitoring uses native APIs with minimal overhead
- Network state monitoring leverages existing NetInfo integration
- Deferral checks are O(1) operations
- Deferral logs are limited in size to prevent storage bloat

## Security Considerations

- Battery and network information is only used locally
- No sensitive data is transmitted
- User preferences are stored locally using AsyncStorage
- Force sync override has automatic timeout to prevent permanent bypass

## Future Enhancements

Potential improvements for future iterations:
- Machine learning-based deferral prediction
- User behavior learning for optimal sync timing
- More granular battery thresholds for different action types
- Network quality-based adaptive sync scheduling
- Integration with device power management APIs

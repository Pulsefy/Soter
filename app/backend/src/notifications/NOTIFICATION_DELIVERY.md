# Notification Delivery System

## Overview

The notification delivery system has been enhanced to support real email and SMS delivery through external providers (SendGrid and Twilio), while maintaining backward compatibility with mock delivery for local development.

## Architecture

### Core Components

1. **Delivery Adapters** (`/adapters`)
   - Common `IDeliveryAdapter` interface for all providers
   - `SendGridEmailAdapter` - Real email delivery via SendGrid
   - `TwilioSmsAdapter` - Real SMS delivery via Twilio
   - `MockDeliveryAdapter` - Simulated delivery for testing/local dev

2. **Adapter Factory** (`DeliveryAdapterFactory`)
   - Selects the appropriate adapter based on configuration
   - Falls back to mock when real providers aren't configured
   - Validates configuration at startup

3. **Notification Processor** (`notifications.processor.ts`)
   - Updated to use adapters instead of hardcoded mock logic
   - Records provider message IDs in outbox
   - Handles delivery failures with proper error reporting

4. **Database Schema**
   - Added `providerMessageId` field to `NotificationOutbox` model
   - Stores provider-assigned message identifiers (SendGrid msg ID, Twilio SID)

## Configuration

### Environment Variables

#### Delivery Mode Selection

```bash
# Set to "mock" for simulated delivery (local dev)
# Set to "real" to use configured providers (production)
NOTIFICATION_DELIVERY_MODE="mock"  # or "real"
```

#### SendGrid Email Configuration

```bash
SENDGRID_API_KEY="your-sendgrid-api-key"
SENDGRID_FROM_EMAIL="noreply@soter.org"
SENDGRID_FROM_NAME="Soter"
```

#### Twilio SMS Configuration

```bash
TWILIO_ACCOUNT_SID="your-twilio-account-sid"
TWILIO_AUTH_TOKEN="your-twilio-auth-token"
TWILIO_FROM_PHONE="+15551234567"  # E.164 format
```

### Configuration Behavior

- **Mock Mode** (`NOTIFICATION_DELIVERY_MODE="mock"`)
  - All notifications use `MockDeliveryAdapter`
  - No external API calls
  - Always succeeds with fake message IDs
  - Logs delivery attempts for debugging

- **Real Mode** (`NOTIFICATION_DELIVERY_MODE="real"`)
  - Email uses SendGrid if `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` are set
  - SMS uses Twilio if `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_PHONE` are set
  - Falls back to mock for unconfigured notification types
  - Logs warnings about missing configuration

## Usage

### Local Development

1. Use mock mode (default):
```bash
NOTIFICATION_DELIVERY_MODE="mock"
```

2. Notifications log delivery attempts but don't call external services
3. Outbox records contain mock message IDs like `mock-email-1234567890`

### Production

1. Set real mode and configure providers:
```bash
NOTIFICATION_DELIVERY_MODE="real"
SENDGRID_API_KEY="your-api-key"
SENDGRID_FROM_EMAIL="noreply@soter.org"
TWILIO_ACCOUNT_SID="your-account-sid"
TWILIO_AUTH_TOKEN="your-auth-token"
TWILIO_FROM_PHONE="+15551234567"
```

2. Notifications are delivered via real providers
3. Outbox records contain real provider message IDs (e.g., SendGrid msg ID, Twilio SID)
4. Delivery failures are retried according to BullMQ retry configuration

## Delivery Flow

1. **Enqueue**: Service creates outbox record and enqueues job
2. **Process**: Processor selects adapter based on notification type and config
3. **Deliver**: Adapter calls provider API (or simulates in mock mode)
4. **Record**: Processor updates outbox with delivery result and provider message ID
5. **Retry**: On failure, BullMQ retries according to retry configuration
6. **Complete**: Final status (sent/failed) recorded in outbox

## Provider Message IDs

Provider message IDs are now stored in the `NotificationOutbox.providerMessageId` field:

- **SendGrid**: X-Message-Id header value (e.g., `abc123def456`)
- **Twilio**: Message SID (e.g., `SM1234567890abcdef`)
- **Mock**: Fake ID with timestamp (e.g., `mock-email-1234567890`)

These IDs can be used to:
- Track delivery status with provider
- Debug delivery issues
- Correlate with provider logs
- Support customer inquiries

## Retry Behavior

Delivery failures are retried automatically by BullMQ:

- **Attempts**: 3 (configured in `notifications.service.ts`)
- **Backoff**: Exponential with 5s initial delay
- **Outbox Status**:
  - `enqueued` - while retries remain
  - `failed` - after all retries exhausted

The outbox `retryCount` field tracks retry attempts, and `lastError` contains the most recent error message.

## Testing

### Unit Tests

All adapters and the factory have comprehensive unit tests:

- `sendgrid-email.adapter.spec.ts` - SendGrid adapter tests
- `twilio-sms.adapter.spec.ts` - Twilio adapter tests
- `delivery-adapter.factory.spec.ts` - Factory and fallback logic tests
- `notifications.processor.spec.ts` - Updated with adapter integration tests

Run tests:
```bash
npm test
```

### Manual Testing

#### Test Mock Delivery
```bash
# Set mock mode
NOTIFICATION_DELIVERY_MODE="mock"

# Trigger notification via API or service
curl -X POST http://localhost:3000/api/v1/notifications/email \
  -H "Content-Type: application/json" \
  -d '{"recipient":"test@example.com","subject":"Test","message":"Test message"}'

# Check logs for mock delivery
# Check outbox for mock message ID
```

#### Test Real Delivery (SendGrid)
```bash
# Configure SendGrid
NOTIFICATION_DELIVERY_MODE="real"
SENDGRID_API_KEY="your-api-key"
SENDGRID_FROM_EMAIL="noreply@soter.org"

# Send test email
# Check SendGrid dashboard for delivery
# Check outbox for real SendGrid message ID
```

#### Test Real Delivery (Twilio)
```bash
# Configure Twilio
NOTIFICATION_DELIVERY_MODE="real"
TWILIO_ACCOUNT_SID="your-sid"
TWILIO_AUTH_TOKEN="your-token"
TWILIO_FROM_PHONE="+15551234567"

# Send test SMS
# Check Twilio dashboard for delivery
# Check outbox for real Twilio SID
```

## Monitoring

### Logs

The system logs delivery attempts at various levels:

- **Debug**: Mock delivery simulation
- **Log**: Successful deliveries with provider message IDs
- **Warn**: Configuration issues, fallback to mock
- **Error**: Delivery failures with error details

### Metrics

Existing metrics track delivery outcomes:

- `notification_delivery_attempt_total{type,outcome}` - Delivery attempts by type and outcome
- `notification_delivery_failure_total{type,category}` - Failures by category
- `callback_failure_total{operation}` - General callback failures

### Outbox Inspection

Query the outbox to inspect delivery status:

```typescript
// Get delivery attempts for a notification
const attempts = await notificationsService.getDeliveryAttempts(outboxId);

// Get stuck notifications
const stuck = await notificationsService.getStuckOutboxRecords();
```

## Troubleshooting

### Emails Not Delivered

1. **Check configuration**:
   - Verify `SENDGRID_API_KEY` is set and valid
   - Verify `SENDGRID_FROM_EMAIL` is verified in SendGrid
   - Check logs for "SendGrid not configured" warning

2. **Check SendGrid dashboard**:
   - Look up delivery by provider message ID from outbox
   - Check for bounces, blocks, or spam reports

3. **Check outbox**:
   - Query by recipient or time range
   - Check `status`, `lastError`, `retryCount`
   - Look at delivery attempt timeline

### SMS Not Delivered

1. **Check configuration**:
   - Verify all three Twilio variables are set
   - Verify `TWILIO_FROM_PHONE` is verified in Twilio
   - Check logs for "Twilio not configured" warning

2. **Check Twilio dashboard**:
   - Look up delivery by SID from outbox
   - Check for invalid phone numbers or carrier issues

3. **Check phone number format**:
   - Must be E.164 format (e.g., `+15551234567`)
   - Validate with Twilio's phone number API

### Fallback to Mock

If logs show "falling back to mock", check:

1. `NOTIFICATION_DELIVERY_MODE` is set to "real"
2. Provider credentials are present and correct
3. No typos in environment variable names
4. Environment variables are loaded correctly

## Security Considerations

- **API Keys**: Store in environment variables, never commit to git
- **From Addresses**: Use verified domains in SendGrid
- **Phone Numbers**: Use verified numbers in Twilio
- **Rate Limiting**: Configure at provider level to prevent abuse
- **Logging**: Provider message IDs are safe to log, but avoid logging full payloads

## Migration Guide

### From Mock to Real Delivery

1. Obtain SendGrid API key and verify sender email
2. Obtain Twilio credentials and verify sender phone
3. Add environment variables to production configuration
4. Set `NOTIFICATION_DELIVERY_MODE="real"`
5. Deploy and monitor logs for successful provider connections
6. Test with low-volume recipients first
7. Monitor outbox for provider message IDs

### Database Migration

The schema change adds a nullable `providerMessageId` column:

```sql
ALTER TABLE "NotificationOutbox" ADD COLUMN "providerMessageId" TEXT;
```

Existing records will have `NULL` for this field. After migration:
- New deliveries will populate this field
- Historical records remain unchanged
- No data loss or backfill required

## Future Enhancements

Possible improvements:

- Additional providers (AWS SES, Mailgun, Postmark, etc.)
- Webhook handlers for delivery status updates
- Template-based emails with variable substitution
- Attachment support for emails
- Rich content for SMS (MMS)
- Push notification support (Firebase, APNs)
- Per-organization provider configuration
- Delivery preference management

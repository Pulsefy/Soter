# Job Status Streaming - Quick Reference

## WebSocket Events

### Client to Server

```javascript
// Subscribe
socket.emit('subscribe', {
  jobId: 'job_123',
  options: {
    statuses: ['processing', 'completed'],
    sendMissedUpdates: true
  }
});

// Unsubscribe
socket.emit('unsubscribe', { jobId: 'job_123' });

// Keep-alive
socket.emit('ping');
```

### Server to Client

```javascript
// Connection
socket.on('connected', (data) => { ... });

// Subscription confirmed
socket.on('subscribed', (ack) => {
  // ack.subscriptionId
  // ack.missedUpdates (array of JobStatusEvent)
});

// Job status update
socket.on('jobStatus', ({ subscriptionId, event }) => {
  // event.job.status
  // event.job.progress
  // event.isTerminal
});

// Errors
socket.on('error', (error) => { ... });

// Keep-alive response
socket.on('pong', (data) => { ... });
```

## REST API Quick Reference

```bash
# Get current status
GET /api/v1/jobs/:jobId/status

# Get status history
GET /api/v1/jobs/:jobId/history?limit=50

# Get subscription count
GET /api/v1/jobs/:jobId/subscriptions

# Get metrics
GET /api/v1/jobs/_/metrics
```

## Job Status Enums

```typescript
enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  RETRYING = 'retrying',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

enum JobType {
  OCR = 'ocr',
  INFERENCE = 'inference',
  PROOF_OF_LIFE = 'proof_of_life',
  ANONYMIZE = 'anonymize',
  HUMANITARIAN_VERIFICATION = 'humanitarian_verification',
  FRAUD_DETECTION = 'fraud_detection'
}
```

## Event Emission (Backend)

```typescript
// Bull job events
this.eventEmitter.emit('bull:job-created', { jobId, jobType });
this.eventEmitter.emit('bull:job-started', { jobId, jobType });
this.eventEmitter.emit('bull:job-progress', { jobId, jobType, progress });
this.eventEmitter.emit('bull:job-completed', { jobId, jobType, result });
this.eventEmitter.emit('bull:job-failed', { jobId, jobType, error });
this.eventEmitter.emit('bull:job-retrying', { jobId, jobType });
this.eventEmitter.emit('bull:job-cancelled', { jobId, jobType });

// Manual events
await this.jobStatusTracker.emitJobStatus({
  jobId: 'job_123',
  jobType: 'inference',
  status: 'processing',
  progress: 50,
  metadata: {
    userId: 'user_123',
    correlationId: 'corr_abc'
  }
});

// AI service events
await this.jobStatusTracker.onAiServiceJobCompleted({
  jobId, jobType, result
});
```

## Client Library Usage

### JavaScript/Node.js

```typescript
import { JobStatusClient } from './lib/jobStatusClient';

const client = new JobStatusClient('http://localhost:3000', token);
await client.connect();

// Subscribe
client.subscribe('job_123', (status) => {
  console.log(`Job: ${status.status} - ${status.progress}%`);
});

// Wait for completion
const result = await client.waitForCompletion('job_123');

// Get status via REST
const current = await client.getStatus('job_123');
const history = await client.getHistory('job_123');

// Cleanup
client.disconnect();
```

### React

```tsx
import { useJobStatus } from '@/lib/jobStatusClient';

export function JobMonitor({ jobId, token }) {
  const { status, error, loading } = useJobStatus(
    'http://localhost:3000',
    token,
    jobId
  );

  if (loading) return <Spinner />;
  if (error) return <Error message={error.message} />;
  
  return (
    <div>
      <ProgressBar value={status?.progress} />
      <StatusBadge status={status?.status} />
    </div>
  );
}
```

## Subscription Options

```typescript
interface SubscriptionOptions {
  jobTypes?: JobType[];           // Filter by job type
  statuses?: JobStatus[];         // Filter by status
  terminalOnly?: boolean;         // Only terminal updates
  maxDuration?: number;           // Subscription TTL (ms)
  sendMissedUpdates?: boolean;    // Deliver missed updates
}
```

## File Locations

```
Backend:
  - DTOs: src/jobs/dtos/job-status-event.dto.ts
  - Services: src/jobs/services/
    - job-status-broadcaster.service.ts
    - job-status-tracker.service.ts
  - Gateway: src/jobs/gateways/job-status.gateway.ts
  - Controller: src/jobs/controllers/job-status-streaming.controller.ts
  - Tests: src/jobs/tests/
  - Docs: src/jobs/*.md

Frontend:
  - Client: src/lib/jobStatusClient.ts
  - Docs: src/jobs/JOB_STATUS_STREAMING.md
```

## Configuration

```env
# Optional CORS configuration
CORS_ORIGIN=http://localhost:3000,https://soter.example.com

# Redis (already configured)
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Module Setup

```typescript
// app.module.ts
imports: [
  ...,
  EventEmitterModule.forRoot(),
  JobsModule,  // Already includes new services
],

// jobs.module.ts
imports: [EventEmitterModule.forRoot()],
providers: [
  JobStatusBroadcaster,
  JobStatusTracker,
  JobStatusGateway,
  ...
],
```

## Testing

```bash
# Run tests
npm test -- src/jobs/tests/

# Test WebSocket
websocat ws://localhost:3000/socket.io/?EIO=4&transport=websocket

# Test REST
curl http://localhost:3000/api/v1/jobs/test_123/status
curl http://localhost:3000/api/v1/jobs/_/metrics
```

## Debugging

### Enable Debug Logging

```typescript
const client = new JobStatusClient(url, token, { debug: true });
```

### Monitor Redis Channels

```bash
# Watch Pub/Sub messages
redis-cli PSUBSCRIBE 'job_status:*'

# Check history
redis-cli LRANGE 'job_status_history:job_123' 0 10

# Check subscriptions
redis-cli HLEN 'job_subscriptions:job_123'
```

### Check Server Logs

```bash
# Look for:
# - JobStatusGateway: Client connected/disconnected
# - JobStatusBroadcaster: Event broadcasts
# - JobStatusTracker: Event emissions
```

## Performance Tips

1. **Reduce reconnect delay** - Use exponential backoff
2. **Batch subscriptions** - Subscribe to multiple jobs efficiently
3. **Use filters** - Let server filter instead of client
4. **Enable keep-alive** - Send ping every 30 seconds
5. **Monitor metrics** - Track subscription count and latency

## Troubleshooting

| Issue | Check | Fix |
|-------|-------|-----|
| No WebSocket connection | Redis running? Port open? | Start Redis, check firewall |
| Missed updates not delivered | sendMissedUpdates: true? | Enable in options |
| High memory | Too many jobs? History size? | Reduce MAX_HISTORY_SIZE |
| Slow delivery | Redis latency? Event rate? | Reduce concurrent jobs |
| Frequent disconnects | Network unstable? | Increase reconnect timeout |

## Integration Checklist

- [ ] Module setup complete
- [ ] Bull processors emit status events
- [ ] AI webhook handler integrated
- [ ] Frontend client installed
- [ ] Tests passing
- [ ] Redis backup configured
- [ ] Monitoring dashboard setup
- [ ] Alerting configured
- [ ] Documentation reviewed
- [ ] Load testing completed

## Additional Resources

- **User Guide**: [JOB_STATUS_STREAMING.md](./JOB_STATUS_STREAMING.md)
- **Integration**: [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)
- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Deployment**: [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Source**: `src/jobs/` directory

## Support

- Check documentation first
- Review error logs
- Test with `websocat` or similar
- Contact platform team if blocked

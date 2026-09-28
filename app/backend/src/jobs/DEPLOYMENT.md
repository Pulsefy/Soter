# Deployment & Migration Guide

## Pre-Deployment Checklist

- [ ] Redis is running and configured
- [ ] Redis persistence enabled (if production)
- [ ] Redis replication configured (if HA needed)
- [ ] Node.js dependencies installed (`socket.io`, `@nestjs/websockets`)
- [ ] Tests passing locally
- [ ] Documentation reviewed

## Step 1: Install Dependencies

```bash
cd app/backend
npm install socket.io @nestjs/websockets
```

Verify installation:
```bash
npm list socket.io @nestjs/websockets
```

## Step 2: Database Setup (Optional)

No database migrations needed. The system uses Redis only, which is already configured.

## Step 3: Environment Configuration

Update `.env` or deployment configuration:

```env
# Optional: Configure CORS for WebSocket
CORS_ORIGIN=http://localhost:3000,https://soter.example.com

# Optional: Enable debug logging
DEBUG=JobStatusGateway:*
```

## Step 4: Run Tests

```bash
# Backend tests
cd app/backend
npm test -- src/jobs/tests/

# Should pass:
# - JobStatusBroadcaster tests
# - JobStatusTracker tests
```

## Step 5: Start the Service

```bash
# Development
npm run start:dev

# Production
npm run start:prod
```

Verify startup logs:
```
[NestFactory] Starting Nest application...
[Nest] Application successfully started
JobStatusGateway initialized with Socket.io
```

## Step 6: Verify WebSocket Server

Test the WebSocket endpoint:

```bash
# Using websocat (install: cargo install websocat)
websocat ws://localhost:3000/socket.io/?EIO=4&transport=websocket

# Should immediately receive connection status
# If not working, check:
# 1. Port 3000 is accessible
# 2. Redis is running
# 3. Check logs for errors
```

## Step 7: Update Job Handlers

### For Bull Processors

Add event emissions to your job processors:

```typescript
// Before
async process(job: Job) {
  const result = await this.doWork(job.data);
  return result;
}

// After
async process(job: Job) {
  this.eventEmitter.emit('bull:job-started', {
    jobId: job.id,
    jobType: 'inference'
  });

  try {
    const result = await this.doWork(job.data);
    
    this.eventEmitter.emit('bull:job-completed', {
      jobId: job.id,
      jobType: 'inference',
      result
    });
    
    return result;
  } catch (error) {
    this.eventEmitter.emit('bull:job-failed', {
      jobId: job.id,
      jobType: 'inference',
      error: {
        code: 'ERR_PROCESSING',
        message: error.message
      }
    });
    throw error;
  }
}
```

### For AI Service Webhooks

Update webhook handler:

```typescript
// Add import
import { JobStatusTracker } from '../jobs/services/job-status-tracker.service';

// Inject service
constructor(
  private jobStatusTracker: JobStatusTracker
) {}

// Update handler
async handleAiWebhook(payload: AiCallbackPayload) {
  if (payload.status === 'completed') {
    await this.jobStatusTracker.onAiServiceJobCompleted({
      jobId: payload.jobId,
      jobType: this.mapType(payload.type),
      result: payload.result
    });
  } else if (payload.status === 'failed') {
    await this.jobStatusTracker.onAiServiceJobFailed({
      jobId: payload.jobId,
      jobType: this.mapType(payload.type),
      error: { code: 'AI_ERROR', message: payload.error }
    });
  }
}
```

## Step 8: Update Frontend

### Installation

```bash
cd app/frontend
npm install socket.io-client
```

### Basic Usage

```typescript
import { JobStatusClient } from '@/lib/jobStatusClient';

// Initialize
const client = new JobStatusClient(
  'http://localhost:3000',
  token,
  { debug: true }
);

// Connect
await client.connect();

// Subscribe
client.subscribe(
  'job_123',
  (status) => {
    console.log('Job status:', status.status);
    console.log('Progress:', status.progress);
  },
  { sendMissedUpdates: true }
);

// Cleanup on unmount
window.addEventListener('beforeunload', () => {
  client.disconnect();
});
```

### React Component Example

```tsx
import { useJobStatus } from '@/lib/jobStatusClient';

export function JobMonitor({ jobId, token }) {
  const { status, error, loading } = useJobStatus(
    process.env.REACT_APP_API_URL,
    token,
    jobId
  );

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <div>Status: {status?.status}</div>
      <div>Progress: {status?.progress}%</div>
    </div>
  );
}
```

## Step 9: Gradual Rollout

### Phase 1: Internal Testing (Week 1)
- [ ] Deploy to staging
- [ ] Test WebSocket connectivity
- [ ] Test job status streaming
- [ ] Load test with 100+ concurrent subscribers
- [ ] Team review and feedback

### Phase 2: Limited Production Release (Week 2)
- [ ] Deploy to production with feature flag
- [ ] Enable for 10% of users
- [ ] Monitor error rates and latency
- [ ] Check Redis memory usage
- [ ] Verify reconnection behavior

### Phase 3: Full Production Release (Week 3)
- [ ] Enable for all users
- [ ] Monitor metrics dashboard
- [ ] Set up alerting
- [ ] Document in runbooks

## Step 10: Monitoring Setup

### Create Monitoring Dashboard

Metrics to track:
```
WebSocket:
  - Active connections
  - Connection duration
  - Disconnection rate
  - Messages/second

Redis:
  - Memory usage
  - Pub/Sub subscribers
  - List operations/sec
  - Latency

Events:
  - Events emitted/sec
  - Delivery latency
  - Failed deliveries
```

### Set Up Alerts

```
Critical:
  - Redis connection lost
  - WebSocket server errors
  - History storage failures

Warning:
  - Memory > 80%
  - Latency > 500ms
  - Error rate > 1%
```

### Health Check Endpoint

```bash
# Add to health checks
curl http://localhost:3000/api/v1/jobs/_/metrics
```

## Step 11: Documentation

- [ ] Update team docs with WebSocket API
- [ ] Add client integration guide
- [ ] Document new job event types
- [ ] Update architecture diagrams
- [ ] Add troubleshooting guide

## Rollback Procedure

If issues are encountered:

```bash
# 1. Disable WebSocket in load balancer
#    (Stop routing new connections)

# 2. Gradually decrease subscription attempts
#    (Set feature flag to 0%)

# 3. Wait for existing connections to drain
#    (Monitor active connections)

# 4. Redeploy previous version if critical issues

# 5. Post-mortem and fixes

# 6. Redeploy when ready
```

## Troubleshooting Guide

### WebSocket Connection Fails

**Symptoms**: Clients can't connect to WebSocket

**Checks**:
1. Port 3000 is open and accessible
2. Redis is running: `redis-cli ping`
3. Check logs for connection errors
4. Verify CORS configuration

**Solution**:
```bash
# Debug connection
curl -v http://localhost:3000/socket.io/?transport=websocket

# Check Redis
redis-cli PING
redis-cli INFO stats | grep connected

# Check logs
docker logs soter-backend
```

### Missed Updates Not Delivered

**Symptoms**: Some status updates are missed after reconnect

**Checks**:
1. `sendMissedUpdates: true` in subscription options
2. History retention not expired (check Redis TTL)
3. Too many events (>100 per job)

**Solution**:
```bash
# Check history in Redis
redis-cli LLEN job_status_history:job_123
redis-cli TTL job_status_history:job_123

# Monitor history cleanup
redis-cli MONITOR | grep EXPIRE
```

### High Memory Usage

**Symptoms**: Redis memory increasing rapidly

**Checks**:
1. Number of active jobs
2. History size per job
3. Subscription records

**Solution**:
```bash
# Check metrics
curl http://localhost:3000/api/v1/jobs/_/metrics

# Monitor Redis memory
redis-cli INFO memory

# Trigger cleanup manually
# (See JobStatusBroadcaster.cleanupHistory())
```

### Slow Message Delivery

**Symptoms**: Large delays between job update and client notification

**Checks**:
1. Redis latency: `redis-cli --latency`
2. Network connectivity
3. Event publishing rate

**Solution**:
```bash
# Check Redis latency
redis-cli --latency

# Monitor event rate
redis-cli MONITOR | wc -l

# Reduce concurrent jobs if needed
# Implement rate limiting
```

## Performance Tuning

### Redis Optimization

```bash
# Increase max connections
redis-cli CONFIG SET maxclients 10000

# Tune persistence if enabled
redis-cli CONFIG SET save "900 1 300 10"

# Monitor performance
redis-cli INFO stats
```

### WebSocket Server Tuning

```typescript
// In gateway initialization
@WebSocketGateway({
  // ...
  transports: ['websocket'], // Skip HTTP long-polling
})
```

### Scale Out (Future)

If Redis becomes bottleneck:
- Add Redis Cluster (sharding by job ID)
- Add multiple WebSocket servers (load balanced)
- Use Redis Streams instead of Lists

## Metrics Collection

### Sample Prometheus Configuration

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'soter-jobs'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
```

### Key Metrics

```
soter_websocket_connections_active{} # Current connections
soter_job_status_events_total{}       # Total events emitted
soter_job_status_latency_ms{}         # Event delivery latency
soter_redis_pub_sub_subscribers{}     # Active Pub/Sub subscribers
```

## Maintenance Tasks

### Daily
- Monitor error rates
- Check memory usage
- Review connection patterns

### Weekly
- Review performance trends
- Clean up old history (automatic)
- Update documentation if needed

### Monthly
- Capacity planning review
- Load test new features
- Disaster recovery drill
- Update runbooks

## Success Metrics

After deployment, verify:
- ✅ < 50ms end-to-end latency
- ✅ > 99% of updates delivered
- ✅ < 5% reconnection failure rate
- ✅ < 50MB Redis memory per 1000 jobs
- ✅ < 2% CPU increase on backend

## Post-Deployment Validation

```bash
# 1. Create test job
curl -X POST http://localhost:3000/api/v1/jobs/test_123 \
  -H "Content-Type: application/json" \
  -d '{"type": "inference"}'

# 2. Subscribe via WebSocket
# Use websocat or websocket client

# 3. Verify status updates received
# Should see: pending → processing → completed

# 4. Test reconnection
# Disconnect and reconnect
# Should receive missed updates

# 5. Check metrics
curl http://localhost:3000/api/v1/jobs/_/metrics
```

## Support

For issues or questions:
1. Check [JOB_STATUS_STREAMING.md](./JOB_STATUS_STREAMING.md) for API docs
2. Review [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) for integration help
3. See [ARCHITECTURE.md](./ARCHITECTURE.md) for design details
4. Check logs for error messages
5. Contact platform team if needed

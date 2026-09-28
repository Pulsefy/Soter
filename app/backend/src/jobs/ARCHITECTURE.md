# Job Status Streaming Architecture

## System Design

### Overview

The Job Status Streaming system provides real-time job status updates to clients through WebSocket connections while maintaining a fallback REST API for polling clients. The system is built on Redis Pub/Sub for event distribution and Bull job queue integration for job lifecycle tracking.

### Components

```
┌─────────────────┐
│  Job Sources    │
├─────────────────┤
│ • Bull Queues   │
│ • AI Webhooks   │
│ • Custom Jobs   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ JobStatusTracker        │
│ (Event Emitter)         │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ JobStatusBroadcaster                │
│ • Redis Pub/Sub Publishing          │
│ • Historical Event Storage          │
│ • Subscription Tracking             │
└────────┬──────────────────┬─────────┘
         │                  │
    ┌────▼────┐      ┌──────▼──────┐
    │ Redis   │      │ Redis Store │
    │ Pub/Sub │      │ (History +  │
    │         │      │  Subs)      │
    └────┬────┘      └─────────────┘
         │
    ┌────▼──────────────────┐
    │ JobStatusGateway      │
    │ (WebSocket Server)    │
    └────┬──────────────────┘
         │
    ┌────▼─────────────────────┐
    │ Connected WebSocket      │
    │ Clients                  │
    └──────────────────────────┘
```

### Data Flow

#### 1. Job Creation

```
Job Created (Bull/Custom)
    ↓
JobStatusTracker.emitJobStatus()
    ↓
JobStatusBroadcaster.broadcastJobStatus()
    ├→ Redis PUBLISH job_status:job_id
    ├→ Redis PUBLISH job_status:broadcast
    └→ Redis LPUSH history, EXPIRE
    ↓
WebSocket Clients receive update
```

#### 2. Client Connection

```
WebSocket Connect
    ↓
JobStatusGateway.handleConnection()
    ├→ Create Redis Subscriber
    └→ Initialize subscription tracking
    ↓
Send "connected" acknowledgment
```

#### 3. Subscription

```
Client: emit('subscribe', {jobId, options})
    ↓
JobStatusGateway.handleSubscribe()
    ├→ Validate options
    ├→ Get missed updates (if sendMissedUpdates=true)
    ├→ Redis HSET subscription record
    ├→ Redis SUBSCRIBE job_status:job_id
    └→ Send "subscribed" acknowledgment
    ↓
Client receives missed updates + streams new ones
```

#### 4. Status Update

```
Job Status Changes
    ↓
Event published to Redis channel
    ↓
JobStatusGateway receives message
    ├→ Deserialize event
    ├→ Apply filters
    └→ WebSocket emit('jobStatus', {...})
    ↓
Client receives real-time update
```

#### 5. Reconnection (Missed Updates)

```
Client loses connection
    ↓
Client reconnects and resubscribes
    ↓
JobStatusGateway.handleSubscribe()
    ├→ Query Redis history (LRANGE)
    ├→ Apply filters
    └→ Include in "subscribed" acknowledgment
    ↓
Client receives missed updates
    ↓
New updates continue streaming
```

## Key Design Decisions

### 1. Redis Pub/Sub for Real-Time Delivery

**Choice**: Redis Pub/Sub instead of WebSocket-only or other message queues

**Rationale**:
- Low-latency delivery (< 1ms)
- Built-in at same Redis instance used for caching
- Automatic cleanup of channels
- Simple subscription model

**Trade-offs**:
- No persistent queue (messages lost if no subscriber)
  - Mitigated by storing history separately
- Requires client to handle reconnects
  - Addressed by missed-update delivery system

### 2. Historical Event Storage

**Choice**: Redis Lists (LPUSH/LRANGE) for storing recent events per job

**Rationale**:
- O(1) append operations
- O(N) retrieval with TTL support
- Bounded storage (MAX_HISTORY_SIZE)
- Automatic expiration (EXPIRE)

**Constraints**:
- Limited history (100 events per job, 24-hour TTL)
- Sufficient for typical reconnect scenarios
- Can be increased for longer-lived jobs

### 3. Per-Job Channels

**Choice**: Separate Redis channels per job instead of broadcast-only

**Rationale**:
- Clients only receive updates for jobs they're interested in
- Reduces bandwidth for systems with many concurrent jobs
- Easier filtering at source

**Design**:
- `job_status:{jobId}` - job-specific updates
- `job_status:broadcast` - all updates (optional aggregation)

### 4. Filter-at-Source

**Choice**: Server-side filtering of events before sending to clients

**Rationale**:
- Reduces network bandwidth
- Clients can specify filtering preferences upfront
- Simplifies client implementation

**Supported Filters**:
- By job type
- By job status
- Terminal-only mode

### 5. Event Structure

**Choice**: Include full job state in each event

**Rationale**:
- Clients don't need to maintain local state
- Events are self-contained and can be processed independently
- Idempotent processing (same event = same result)

**Tradeoff**: Slightly larger event payload vs. simplicity

## Resilience Patterns

### 1. Connection Loss Recovery

```typescript
// Client-side
socket.on('disconnect', () => {
  // Wait with exponential backoff
  setTimeout(() => socket.connect(), backoffTime);
});

socket.on('reconnect', () => {
  // Resubscribe with missed-update flag
  socket.emit('subscribe', { 
    jobId,
    options: { sendMissedUpdates: true }
  });
});
```

### 2. Missed Update Delivery

```
Disconnection window: 50 seconds
  ├→ Job status changes 5 times
  └→ Changes stored in Redis history

Client reconnects
  ├→ Queries Redis history for this job
  ├→ Retrieves 5 cached events
  └→ Sends in "subscribed" acknowledgment

Client receives all changes in order
```

### 3. Subscription Timeout

```
Subscription duration > maxDuration (default 1 hour)
  ├→ Automatic termination
  └→ Client must resubscribe

Benefits:
  • Prevents stale subscriptions
  • Catches disconnected clients
  • Controlled memory growth
```

## Performance Characteristics

### Latency

- **Pub/Sub Delivery**: < 1ms (local Redis)
- **History Query**: 5-50ms (depends on history size)
- **WebSocket Transmission**: 10-100ms (network dependent)
- **Total E2E**: 50-150ms typical

### Memory Usage

```
Per Job (worst case):
  ├→ History: 100 events × ~500B = 50KB
  ├→ Subscriptions: 100 subs × ~200B = 20KB
  └→ Total: ~70KB

10,000 active jobs:
  └→ Total: ~700MB
```

### Throughput

```
Single Redis instance:
  ├→ Publish rate: 100k+ ops/sec
  ├→ Subscribe rate: 100k+ ops/sec
  └→ Can handle thousands of concurrent subscribers
```

## Scalability Considerations

### Horizontal Scaling

**Current Design** (Single Redis):
- Works for ~10,000 concurrent jobs
- Suitable for small-to-medium deployments

**Future Enhancement** (Redis Cluster):
- Shard by job ID
- Each shard handles disjoint set of jobs
- Requires client coordination

### Vertical Scaling

- Add memory to Redis instance
- Increase `MAX_HISTORY_SIZE` if needed
- Adjust subscription TTLs

## Failure Modes

### Redis Down

**Impact**:
- No real-time streaming
- No history storage
- No subscription tracking

**Mitigation**:
- Redis replication + failover
- Alert on Redis unavailability
- Clients fall back to polling REST API

**Recovery**:
- WebSocket server continues running
- Clients receive error messages
- Automatic reconnect attempts

### Network Partition

**Impact**:
- Client disconnects
- Events during partition are lost from history
- Subscription records expire

**Recovery**:
- Client reconnects after partition heals
- Gets available history (events after partition)
- Continues receiving new updates

### Subscriber Overload

**Impact**:
- High CPU/memory in WebSocket server
- Slow message processing

**Mitigation**:
- Limit concurrent subscriptions per user
- Rate limit subscription requests
- Circuit breaker for slow clients

## Monitoring

### Key Metrics

```
Redis:
  • Connection count
  • Memory usage
  • Pub/Sub subscribers
  • List operations/sec

WebSocket:
  • Active connections
  • Messages/sec
  • Error rate
  • Subscription count per job

Events:
  • Events emitted/sec
  • Average event latency
  • Event delivery success rate
```

### Alerts

```
Critical:
  • Redis connection lost
  • WebSocket server errors
  • History storage failures

Warning:
  • Memory usage > 80%
  • Event latency > 500ms
  • Subscription timeouts > 5%
  • Failed reconnections > 1%
```

## Testing Strategy

### Unit Tests

- Event emission and filtering
- History management
- Subscription tracking
- Error handling

### Integration Tests

- Redis Pub/Sub flow
- WebSocket message delivery
- Reconnection scenarios
- Missed update delivery

### Load Tests

- 1,000+ concurrent subscribers
- 100+ events/second
- Various network conditions
- Connection churn (connect/disconnect cycles)

## Security Considerations

### Authentication

- JWT token or API key in WebSocket handshake
- Validated on connection
- Could add scope-based filtering (e.g., only user's jobs)

### Authorization

- Clients can only subscribe to jobs they own/have permission for
- Should be enforced by adding userId to job metadata
- Broadcaster doesn't enforce; depends on upstream

### Message Validation

- Validate event structure before broadcast
- Prevent malformed events from causing client errors
- Error tracking and alerting

## Future Enhancements

### 1. Batch Subscriptions

```
Client: emit('subscribe', {
  jobIds: ['job_1', 'job_2', ...],
  options: {...}
})
```

**Benefits**: Reduce handshake latency for multiple jobs

### 2. Server-Side Session Persistence

```
Save subscriptions to Redis on disconnect
Restore on reconnect
Automatic refresh every hour
```

**Benefits**: Seamless reconnection without client re-subscribe

### 3. Event Filtering Language

```
subscribe({
  filter: "status IN (processing, completed) AND progress > 50"
})
```

**Benefits**: More flexible filtering at source

### 4. Kafka/RabbitMQ Integration

```
Broadcast to external event bus
Enable multi-system job tracking
```

**Benefits**: Integrate with reporting/analytics systems

### 5. Event Replay

```
GET /jobs/{jobId}/events?from=2026-01-01T00:00:00Z
```

**Benefits**: Retrieve full job history beyond 24 hours

## Deployment Checklist

- [ ] Redis persistent storage configured
- [ ] Redis replication/backup enabled
- [ ] WebSocket CORS properly configured
- [ ] Rate limiting in place
- [ ] Monitoring dashboards set up
- [ ] Alerting configured
- [ ] Load testing completed
- [ ] Documentation reviewed with team
- [ ] Client libraries tested
- [ ] Rollout plan for gradual migration

## References

- [Socket.io Documentation](https://socket.io/docs/)
- [Redis Pub/Sub](https://redis.io/docs/manual/pub-sub/)
- [Bull Job Queue](https://github.com/OptimalBits/bull)
- [NestJS WebSockets](https://docs.nestjs.com/websockets/gateways)

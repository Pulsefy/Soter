# Job Status Streaming API

This document describes the push/streaming mechanism for job status updates in the Soter platform. Instead of polling endpoints aggressively, clients can subscribe to real-time job status updates via WebSocket or query history via REST endpoints.

## Overview

- **Push Mechanism**: WebSocket-based real-time streaming for active clients
- **Fallback**: REST API with history for polling clients
- **Reconnect Handling**: Automatic missed-update detection and delivery
- **State Coverage**: Both terminal (completed, failed, cancelled) and non-terminal (pending, processing, retrying) states

## Architecture

### Components

1. **JobStatusGateway** (`/socket.io/jobs`)
   - WebSocket server for real-time subscriptions
   - Handles client connections and status streaming
   - Manages subscription filtering

2. **JobStatusBroadcaster**
   - Redis Pub/Sub channel manager
   - Event broadcasting to subscribed clients
   - Historical event storage for reconnects

3. **JobStatusTracker**
   - Emits events when jobs change state
   - Integrates with Bull job queue events
   - Receives webhooks from AI service

4. **REST API** (`/api/v1/jobs`)
   - Query current job status
   - Retrieve job history
   - View subscription metrics

## WebSocket API

### Connection

Connect to the WebSocket server at: `ws://localhost:3000/socket.io/jobs`

**Authentication**: Include JWT token or API key in the connection handshake.

```javascript
const socket = io('ws://localhost:3000', {
  path: '/socket.io/jobs',
  auth: {
    token: 'your-jwt-token-or-api-key'
  }
});

socket.on('connect', () => {
  console.log('Connected to job status stream');
});

socket.on('connected', (data) => {
  console.log('Server acknowledgment:', data);
  // { socketId: '...', timestamp: '...', message: '...' }
});
```

### Subscribe to Job Status

Send a subscribe message with job ID and optional filters:

```javascript
socket.emit('subscribe', {
  jobId: 'job_123abc',
  options: {
    jobTypes: ['inference', 'ocr'],  // Optional: filter by job type
    statuses: ['processing', 'completed', 'failed'],  // Optional: filter by status
    terminalOnly: false,  // Optional: only terminal state updates
    maxDuration: 3600000,  // Optional: max subscription duration (1 hour default)
    sendMissedUpdates: true  // Optional: request missed updates on reconnect
  }
});
```

### Listen for Status Updates

```javascript
socket.on('subscribed', (ack) => {
  // Subscription confirmed
  const { subscriptionId, options, serverTime, missedUpdates } = ack;
  console.log(`Subscribed: ${subscriptionId}`);
  
  // Process any missed updates from reconnect
  if (missedUpdates && missedUpdates.length > 0) {
    console.log(`Received ${missedUpdates.length} missed updates`);
    missedUpdates.forEach(event => processStatusUpdate(event));
  }
});

socket.on('jobStatus', (data) => {
  const { subscriptionId, event } = data;
  console.log(`Job ${event.job.id} status: ${event.job.status}`);
  console.log(`Progress: ${event.job.progress}%`);
  
  if (event.isTerminal) {
    if (event.job.status === 'completed') {
      console.log('Result:', event.job.result);
    } else if (event.job.status === 'failed') {
      console.log('Error:', event.job.error);
    }
  }
});

socket.on('error', (error) => {
  console.error('Subscription error:', error);
});
```

### Unsubscribe from Job Status

```javascript
socket.emit('unsubscribe', {
  jobId: 'job_123abc'
});

socket.on('unsubscribed', (data) => {
  console.log('Unsubscribed from job:', data.jobId);
});
```

### Keep-Alive Ping

The client should periodically send a ping to maintain the connection:

```javascript
setInterval(() => {
  socket.emit('ping');
}, 30000);  // Every 30 seconds

socket.on('pong', (data) => {
  console.log('Connection alive at:', data.timestamp);
});
```

## Reconnect Behavior

### Automatic Missed Update Delivery

When a client reconnects:

1. Subscribe to the job again with `sendMissedUpdates: true`
2. The server queries Redis history for events since last subscription
3. Missed updates are sent in the `subscribed` acknowledgment
4. New updates continue to stream as they occur

```javascript
// Example: Reconnection logic
socket.on('disconnect', () => {
  console.log('Disconnected - attempting reconnect in 5 seconds');
});

socket.on('reconnect', () => {
  console.log('Reconnected - resubscribing to jobs');
  
  // Resubscribe to all jobs
  jobIds.forEach(jobId => {
    socket.emit('subscribe', {
      jobId,
      options: { sendMissedUpdates: true }
    });
  });
});
```

### History Retention

- Historical events are stored in Redis for **24 hours**
- Up to **100 recent events** per job are kept
- Events are automatically cleaned up after expiration

### Recommended Reconnect Strategy

```javascript
// Exponential backoff with max 30 seconds
const reconnectDelay = Math.min(
  1000 * Math.pow(2, attemptCount),
  30000
);

setTimeout(() => {
  socket.connect();
}, reconnectDelay);
```

## REST API

### Get Current Job Status

```bash
GET /api/v1/jobs/:jobId/status

# Response
{
  "id": "job_123abc",
  "type": "inference",
  "status": "processing",
  "progress": 45,
  "createdAt": "2026-07-24T10:00:00.000Z",
  "updatedAt": "2026-07-24T10:05:23.000Z"
}
```

### Get Job Status History

Retrieve recent status updates for a job (useful for polling clients):

```bash
GET /api/v1/jobs/:jobId/history?limit=50

# Response
{
  "jobId": "job_123abc",
  "events": [
    {
      "eventId": "evt_001",
      "job": {
        "id": "job_123abc",
        "type": "inference",
        "status": "pending",
        "createdAt": "2026-07-24T10:00:00.000Z",
        "updatedAt": "2026-07-24T10:00:01.000Z"
      },
      "emittedAt": "2026-07-24T10:00:01.000Z",
      "isTerminal": false
    },
    {
      "eventId": "evt_002",
      "job": {
        "id": "job_123abc",
        "type": "inference",
        "status": "processing",
        "progress": 45,
        "createdAt": "2026-07-24T10:00:00.000Z",
        "updatedAt": "2026-07-24T10:05:23.000Z"
      },
      "emittedAt": "2026-07-24T10:05:23.000Z",
      "isTerminal": false
    }
  ]
}
```

### Get Subscription Metrics

```bash
GET /api/v1/jobs/:jobId/subscriptions

# Response
{
  "jobId": "job_123abc",
  "activeSubscriptions": 3,
  "totalHistoryEvents": 15
}
```

### Get Global Metrics

```bash
GET /api/v1/jobs/_/metrics

# Response
{
  "historyRecords": 250,
  "totalHistoryEvents": 5000,
  "subscriptionHolders": 45,
  "totalActiveSubscriptions": 120
}
```

## Job Status States

### Non-Terminal States

- **PENDING**: Job queued and waiting for processing
- **PROCESSING**: Worker actively processing the job
- **RETRYING**: Failed job being retried

### Terminal States

- **COMPLETED**: Job finished successfully
- **FAILED**: Job failed (will not be retried beyond max retries)
- **CANCELLED**: Job was manually cancelled

## Event Structure

```typescript
interface JobStatusEvent {
  // Unique event identifier for deduplication
  eventId: string;
  
  // Job status information
  job: {
    id: string;
    type: 'ocr' | 'inference' | 'proof_of_life' | ...;
    status: 'pending' | 'processing' | 'completed' | 'failed' | ...;
    progress?: number;  // 0-100 for non-terminal states
    result?: any;       // Only set for completed jobs
    error?: {
      code: string;
      message: string;
      details?: any;
    };
    createdAt: Date;
    updatedAt: Date;
  };
  
  // Optional: user ID if tracking per-user jobs
  userId?: string;
  
  // Optional: correlation ID for tracing
  correlationId?: string;
  
  // Server timestamp
  emittedAt: Date;
  
  // Indicates if this is a terminal state
  isTerminal: boolean;
  
  // Optional: contextual metadata
  metadata?: {
    campaignId?: string;
    claimId?: string;
    packageId?: string;
  };
}
```

## Integration with AI Service

The backend automatically publishes job status updates from:

1. **Bull Job Queue Events**
   - Job created, started, completed, failed, retrying
   - Events are converted to WebSocket messages

2. **AI Service Webhooks**
   - When AI service completes or fails a job
   - Status is updated and broadcasted to subscribers

## Error Handling

### Connection Errors

```javascript
socket.on('connect_error', (error) => {
  console.error('Connection error:', error.message);
  // Automatically retries with exponential backoff
});
```

### Subscription Errors

```javascript
socket.on('error', (error) => {
  console.error('Subscription error:', error);
  // Invalid jobId, filters, or server error
});
```

### Timeout Handling

- Subscriptions are automatically terminated after `maxDuration`
- Client should resubscribe for continued updates
- Missed updates are provided on resubscription

## Client Implementation Examples

### JavaScript/Node.js

```javascript
import io from 'socket.io-client';

class JobStatusClient {
  constructor(token) {
    this.socket = io('ws://localhost:3000', {
      path: '/socket.io/jobs',
      auth: { token }
    });
    this.subscriptions = new Map();
    this.setupHandlers();
  }

  setupHandlers() {
    this.socket.on('connect', () => {
      console.log('Connected to job stream');
    });

    this.socket.on('jobStatus', ({ subscriptionId, event }) => {
      this.handleStatusUpdate(event);
    });

    this.socket.on('subscribed', (ack) => {
      console.log(`Subscribed: ${ack.subscriptionId}`);
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected - will attempt reconnect');
    });
  }

  subscribe(jobId, options = {}) {
    this.socket.emit('subscribe', {
      jobId,
      options: {
        sendMissedUpdates: true,
        ...options
      }
    });
    this.subscriptions.set(jobId, options);
  }

  unsubscribe(jobId) {
    this.socket.emit('unsubscribe', { jobId });
    this.subscriptions.delete(jobId);
  }

  handleStatusUpdate(event) {
    console.log(`Job ${event.job.id}: ${event.job.status}`);
    if (event.job.progress) {
      console.log(`Progress: ${event.job.progress}%`);
    }
    if (event.isTerminal) {
      console.log('Job completed');
    }
  }
}
```

### React

```jsx
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

export function JobStatusMonitor({ jobId, token }) {
  const [status, setStatus] = useState('pending');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    const socket = io('ws://localhost:3000', {
      path: '/socket.io/jobs',
      auth: { token }
    });

    socket.emit('subscribe', {
      jobId,
      options: { sendMissedUpdates: true }
    });

    socket.on('jobStatus', ({ event }) => {
      setStatus(event.job.status);
      if (event.job.progress) {
        setProgress(event.job.progress);
      }
      if (event.job.error) {
        setError(event.job.error.message);
      }
    });

    return () => {
      socket.emit('unsubscribe', { jobId });
      socket.disconnect();
    };
  }, [jobId, token]);

  return (
    <div>
      <div>Status: {status}</div>
      <div>Progress: {progress}%</div>
      {error && <div>Error: {error}</div>}
    </div>
  );
}
```

## Testing

### Test WebSocket Connection

```bash
# Using websocat
websocat ws://localhost:3000/socket.io/?EIO=4&transport=websocket

# Subscribe to a job
{"emit":["subscribe",{"jobId":"test_123","options":{}}]}
```

### Test REST API

```bash
# Get job status
curl http://localhost:3000/api/v1/jobs/test_123/status

# Get job history
curl http://localhost:3000/api/v1/jobs/test_123/history?limit=10

# Get metrics
curl http://localhost:3000/api/v1/jobs/_/metrics
```

## Performance Considerations

1. **History Retention**
   - Limited to 100 events per job and 24-hour TTL
   - Reduces Redis memory usage while covering typical reconnect scenarios

2. **Channel Efficiency**
   - Job-specific channels for targeted subscriptions
   - Broadcast channel for system-wide monitoring

3. **Filtering**
   - Server-side filtering reduces client-side processing
   - Clients can filter by job type and status

4. **Rate Limiting**
   - WebSocket connections are subject to the same rate limits as REST API
   - Metrics endpoint has stricter limits to prevent abuse

## Troubleshooting

### Missing Updates After Reconnect

Check if `sendMissedUpdates` is enabled and Redis connection is active.

### High Memory Usage

Monitor metrics endpoint for excessive history accumulation. Verify history cleanup is running.

### Connection Drops

Enable client-side keep-alive pings every 30 seconds. Check network stability and increase timeout if needed.

## Future Enhancements

- Batch subscription support (subscribe to multiple jobs at once)
- Server-side subscription persistence (resume after server restart)
- Subscription filters at subscription time (reduce network overhead)
- Event streaming to external systems (Kafka, etc.)

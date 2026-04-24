# Session Management System

A comprehensive session management system for multi-step verification flows with idempotent handling, status transitions, and retry logic.

## Overview

The session management system provides a first-class session concept that makes multi-step verification flows easier to reason about and retry. It supports:

- **Multi-step workflows** with configurable steps and retry limits
- **Idempotent submissions** using unique submission keys
- **Status transitions** with proper state management
- **Session expiration and resumption** capabilities
- **Comprehensive error handling** and retry logic
- **Context-based session grouping** for user/claim tracking

## Architecture

### Core Models

#### Session
The main session entity that tracks the overall verification flow:
- `type`: Session type (otp_verification, claim_verification, multi_step_verification)
- `status`: Current status (pending, completed, expired, failed)
- `contextId`: Groups related sessions (user ID, claim ID, etc.)
- `metadata`: Additional context information
- `expiresAt`: Optional expiration time

#### SessionStep
Individual steps within a session:
- `stepName`: Identifier for the step type
- `stepOrder`: Order of execution
- `status`: Step status (pending, in_progress, completed, failed, skipped)
- `attempts`: Current attempt count
- `maxAttempts`: Maximum allowed attempts
- `input/output`: Step data

#### SessionSubmission
Tracks individual submissions for idempotent handling:
- `submissionKey`: Unique identifier for the submission
- `payload`: Submitted data
- `response`: Processing result

## Usage

### 1. Creating a Simple Session

```typescript
const session = await sessionService.createSession({
  type: SessionType.otp_verification,
  contextId: 'user_12345',
  metadata: { channel: 'email' },
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  steps: [
    {
      stepName: 'otp_validation',
      stepOrder: 1,
      maxAttempts: 3,
    },
  ],
});
```

### 2. Creating a Multi-Step Session

```typescript
const session = await sessionService.createSession({
  type: SessionType.multi_step_verification,
  contextId: 'claim_67890',
  steps: [
    { stepName: 'document_upload', stepOrder: 1, maxAttempts: 3 },
    { stepName: 'identity_verification', stepOrder: 2, maxAttempts: 2 },
    { stepName: 'claim_verification', stepOrder: 3, maxAttempts: 1 },
  ],
});
```

### 3. Submitting to a Step (Idempotent)

```typescript
const result = await sessionService.submitToStep(sessionId, stepId, {
  submissionKey: 'unique-key-123', // Ensures idempotency
  payload: {
    documentUrl: 'https://example.com/doc.pdf',
    documentType: 'passport',
  },
});

// Retry with same key returns same result
const retryResult = await sessionService.submitToStep(sessionId, stepId, {
  submissionKey: 'unique-key-123', // Same key
  payload: { /* same or different payload */ },
});

console.log(retryResult.isIdempotent); // true
```

### 4. Monitoring Session Progress

```typescript
const session = await sessionService.getSession(sessionId);

console.log({
  status: session.status,
  currentStep: session.currentStep?.stepName,
  nextStep: session.nextStep?.stepName,
  progress: `${session.steps?.filter(s => s.status === 'completed').length}/${session.steps?.length}`,
});
```

### 5. Handling Session Expiration

```typescript
// Sessions auto-expire when accessed after expiration time
const session = await sessionService.getSession(sessionId);
if (session.status === 'expired') {
  // Resume the session
  const resumedSession = await sessionService.resumeSession(sessionId);
  console.log('Session resumed with new expiration:', resumedSession.expiresAt);
}
```

## API Endpoints

### POST /v1/sessions
Create a new session

**Request:**
```json
{
  "type": "multi_step_verification",
  "contextId": "claim_123",
  "metadata": { "claimAmount": 1000 },
  "expiresAt": "2024-12-31T23:59:59Z",
  "steps": [
    { "stepName": "document_upload", "stepOrder": 1, "maxAttempts": 3 },
    { "stepName": "identity_verification", "stepOrder": 2, "maxAttempts": 2 }
  ]
}
```

### GET /v1/sessions/:id
Get session details

**Response:**
```json
{
  "id": "session_123",
  "type": "multi_step_verification",
  "status": "pending",
  "contextId": "claim_123",
  "currentStep": {
    "id": "step_1",
    "stepName": "document_upload",
    "status": "pending",
    "attempts": 0,
    "maxAttempts": 3
  },
  "nextStep": {
    "stepName": "identity_verification"
  },
  "steps": [...]
}
```

### POST /v1/sessions/:sessionId/steps/:stepId/submit
Submit data to a step

**Request:**
```json
{
  "submissionKey": "unique-submission-123",
  "payload": {
    "documentUrl": "https://example.com/doc.pdf",
    "documentType": "passport"
  }
}
```

**Response:**
```json
{
  "id": "submission_456",
  "sessionId": "session_123",
  "stepId": "step_1",
  "submissionKey": "unique-submission-123",
  "response": {
    "success": true,
    "documentId": "doc_789"
  },
  "isIdempotent": false
}
```

### POST /v1/sessions/:id/resume
Resume an expired session

### GET /v1/sessions?contextId=:contextId
Get sessions by context ID

## Step Types and Processing

The system supports various step types with built-in processing logic:

### otp_validation
Validates OTP codes
```typescript
payload: {
  code: "123456",
  expectedCode: "123456"
}
```

### document_upload
Processes document uploads
```typescript
payload: {
  documentUrl: "https://example.com/doc.pdf",
  documentType: "passport"
}
```

### identity_verification
Verifies identity information
```typescript
payload: {
  identityDocument: { type: "passport", number: "P123456" },
  personalInfo: { name: "John Doe", dob: "1990-01-01" }
}
```

### claim_verification
Verifies humanitarian claims
```typescript
payload: {
  claimId: "claim_123",
  evidence: { type: "humanitarian_need", severity: "high" }
}
```

## Error Handling

### Automatic Retry Logic
- Steps track attempt counts against `maxAttempts`
- Failed steps can be retried until max attempts reached
- Sessions fail when critical steps exceed max attempts

### Idempotent Submissions
- Use unique `submissionKey` for each logical submission
- Duplicate keys return cached responses
- Prevents duplicate processing from network retries, user double-clicks, etc.

### Session Expiration
- Sessions auto-expire when accessed after `expiresAt`
- Expired sessions can be resumed with new expiration time
- Resumption extends session lifetime and reactivates pending steps

## Testing

The system includes comprehensive tests:

### Unit Tests
- `session.service.spec.ts`: Service logic testing
- `session.controller.spec.ts`: Controller endpoint testing

### Integration Tests
- `session.integration.spec.ts`: End-to-end flow testing
- Tests complete multi-step flows
- Tests idempotent behavior
- Tests error handling and recovery
- Tests session expiration and resumption

### Running Tests
```bash
npm run test -- --testPathPattern=session
```

## Database Schema

### Migration
The system includes a migration that:
- Creates new session tables
- Migrates existing `VerificationSession` data
- Adds proper indexes for performance

### Key Indexes
- `Session_type_status_idx`: Query by type and status
- `Session_contextId_idx`: Group by context
- `SessionSubmission_submissionKey_idx`: Unique submission keys
- `SessionStep_sessionId_stepOrder_idx`: Ordered step lookup

## Best Practices

### Submission Keys
- Use UUIDs or timestamp-based keys for uniqueness
- Include user/session context in key generation
- Example: `${userId}_${stepName}_${timestamp}`

### Error Handling
- Implement exponential backoff for retries
- Provide clear user feedback on failures
- Log all session state transitions for debugging

### Session Cleanup
- Implement background jobs to clean up old sessions
- Archive completed sessions after retention period
- Monitor session analytics for optimization

### Security
- Validate all step inputs
- Encrypt sensitive data in session metadata
- Implement proper authorization checks

## Integration Examples

See `examples/session-usage.example.ts` for comprehensive usage examples including:
- Simple OTP sessions
- Multi-step identity verification
- Claim verification workflows
- Idempotent submission handling
- Error recovery patterns
- Batch operations
- Analytics and reporting

## Enhanced Verification Flow

The `EnhancedVerificationFlowService` demonstrates integration with existing verification systems:
- Combines traditional OTP with additional verification steps
- Maintains backward compatibility
- Provides unified session tracking
- Supports progressive enhancement of verification requirements
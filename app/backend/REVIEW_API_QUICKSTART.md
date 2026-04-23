# Manual Review API - Quick Start Guide

## Overview
Two new endpoints for managing manual verification reviews.

## Authentication
All endpoints require JWT authentication:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## 1. Get Review Queue

**Endpoint**: `GET /v1/verification/reviews/queue`

### Query Parameters
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| status | enum | No | all | Filter by: `pending_review`, `approved`, `rejected` |
| page | integer | No | 1 | Page number (min: 1) |
| limit | integer | No | 20 | Items per page (min: 1, max: 100) |

### Examples

**Get all pending reviews:**
```bash
curl -X GET 'http://localhost:3000/v1/verification/reviews/queue?status=pending_review' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Get page 2 with 10 items:**
```bash
curl -X GET 'http://localhost:3000/v1/verification/reviews/queue?page=2&limit=10' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Get all approved reviews:**
```bash
curl -X GET 'http://localhost:3000/v1/verification/reviews/queue?status=approved' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Response
```json
{
  "data": [
    {
      "id": "claim123",
      "status": "requested",
      "reviewStatus": "pending_review",
      "amount": "500.00",
      "recipientRef": "REF-12345",
      "evidenceRef": "https://example.com/doc.jpg",
      "verificationScore": 0.65,
      "verificationResult": {
        "score": 0.65,
        "confidence": 0.8,
        "details": {
          "factors": ["Document provided", "Identity unclear"],
          "riskLevel": "medium",
          "recommendations": ["Manual review recommended"]
        }
      },
      "reviewSlaStartedAt": "2025-01-23T10:00:00.000Z",
      "createdAt": "2025-01-23T09:00:00.000Z",
      "campaign": {
        "id": "camp123",
        "name": "Emergency Relief 2025"
      }
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

---

## 2. Submit Review Decision

**Endpoint**: `POST /v1/verification/reviews/:claimId/submit`

### Path Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| claimId | string | Yes | ID of the claim to review |

### Request Body
| Field | Type | Required | Max Length | Description |
|-------|------|----------|------------|-------------|
| decision | enum | Yes | - | `approved` or `rejected` |
| reason | string | Yes | 500 | Public reason for decision |
| note | string | No | 1000 | Internal note (not visible to claimant) |

### Examples

**Approve a claim:**
```bash
curl -X POST 'http://localhost:3000/v1/verification/reviews/claim123/submit' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "approved",
    "reason": "All documents verified successfully",
    "note": "Contacted applicant via phone for additional verification"
  }'
```

**Reject a claim:**
```bash
curl -X POST 'http://localhost:3000/v1/verification/reviews/claim456/submit' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "rejected",
    "reason": "Insufficient evidence provided. Missing proof of residence."
  }'
```

**Approve without internal note:**
```bash
curl -X POST 'http://localhost:3000/v1/verification/reviews/claim789/submit' \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "approved",
    "reason": "Documents verified"
  }'
```

### Response
```json
{
  "id": "claim123",
  "status": "verified",
  "reviewStatus": "approved",
  "reviewedBy": "reviewer123",
  "reviewedAt": "2025-01-23T15:30:00.000Z",
  "reviewReason": "All documents verified successfully",
  "reviewNote": "Contacted applicant via phone for additional verification",
  "amount": "500.00",
  "recipientRef": "REF-12345",
  "campaignId": "camp123",
  "verificationScore": 0.65,
  "createdAt": "2025-01-23T09:00:00.000Z",
  "updatedAt": "2025-01-23T15:30:00.000Z"
}
```

---

## Status Flow

```
Claim Created
    ↓
AI Verification
    ↓
Score 0.5-0.7? → YES → reviewStatus: pending_review
    ↓                        ↓
    NO                  Manual Review
    ↓                        ↓
Auto-approved         Approved/Rejected
or rejected                 ↓
                      reviewStatus: approved/rejected
                      status: verified/requested
```

---

## Error Responses

### 400 Bad Request
Invalid input data:
```json
{
  "statusCode": 400,
  "message": [
    "decision must be one of the following values: approved, rejected",
    "reason should not be empty",
    "reason must be shorter than or equal to 500 characters"
  ],
  "error": "Bad Request"
}
```

### 401 Unauthorized
Missing or invalid JWT token:
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 404 Not Found
Claim doesn't exist:
```json
{
  "statusCode": 404,
  "message": "Claim with ID claim123 not found",
  "error": "Not Found"
}
```

---

## Common Use Cases

### 1. Review Dashboard
```javascript
// Fetch pending reviews for dashboard
const response = await fetch(
  '/v1/verification/reviews/queue?status=pending_review&limit=50',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);
const { data, total } = await response.json();
```

### 2. Approve Claim
```javascript
const response = await fetch(
  `/v1/verification/reviews/${claimId}/submit`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      decision: 'approved',
      reason: 'All documents verified',
      note: 'Called applicant to confirm details'
    })
  }
);
```

### 3. SLA Monitoring
```javascript
// Get oldest pending reviews (potential SLA breach)
const response = await fetch(
  '/v1/verification/reviews/queue?status=pending_review&limit=10',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);
const { data } = await response.json();

// Check SLA (e.g., 24 hours)
const slaThreshold = 24 * 60 * 60 * 1000; // 24 hours in ms
const overdueReviews = data.filter(claim => {
  const age = Date.now() - new Date(claim.reviewSlaStartedAt).getTime();
  return age > slaThreshold;
});
```

### 4. Review History
```javascript
// Get all approved reviews
const approved = await fetch(
  '/v1/verification/reviews/queue?status=approved&limit=100',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);

// Get all rejected reviews
const rejected = await fetch(
  '/v1/verification/reviews/queue?status=rejected&limit=100',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);
```

---

## Best Practices

### 1. Always Provide Detailed Reasons
```javascript
// ❌ Bad
{ decision: 'rejected', reason: 'No' }

// ✅ Good
{ 
  decision: 'rejected', 
  reason: 'Missing proof of residence. ID document expired. Unable to verify identity.'
}
```

### 2. Use Internal Notes for Context
```javascript
// ✅ Good practice
{
  decision: 'approved',
  reason: 'All documents verified successfully',
  note: 'Applicant called on 2025-01-23. Confirmed address matches utility bill. Cross-referenced with government database.'
}
```

### 3. Handle Pagination for Large Queues
```javascript
async function getAllPendingReviews() {
  let page = 1;
  let allReviews = [];
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(
      `/v1/verification/reviews/queue?status=pending_review&page=${page}&limit=100`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const { data, total } = await response.json();
    
    allReviews = [...allReviews, ...data];
    hasMore = allReviews.length < total;
    page++;
  }

  return allReviews;
}
```

### 4. Monitor SLA Compliance
```javascript
function calculateSlaStatus(reviewSlaStartedAt, slaHours = 24) {
  const startTime = new Date(reviewSlaStartedAt).getTime();
  const now = Date.now();
  const elapsed = now - startTime;
  const slaMs = slaHours * 60 * 60 * 1000;
  
  return {
    elapsedHours: elapsed / (60 * 60 * 1000),
    remainingHours: Math.max(0, (slaMs - elapsed) / (60 * 60 * 1000)),
    isBreached: elapsed > slaMs,
    percentUsed: (elapsed / slaMs) * 100
  };
}
```

---

## Swagger Documentation

Interactive API documentation available at:
```
http://localhost:3000/api
```

Try out endpoints directly in the browser with the Swagger UI.

---

## Support

For issues or questions:
1. Check the full implementation guide: `MANUAL_REVIEW_IMPLEMENTATION.md`
2. Review test documentation: `REVIEW_WORKFLOW_TESTS.md`
3. Check test results: `TEST_RESULTS.md`

# Global Error Handling and Canonical API Error Code Catalog

## Overview

This implementation provides a standardized error handling mechanism and a canonical machine-readable error code catalog across the entire backend application. All errors follow a consistent JSON envelope with `traceId` tracking, stable string `errorCode` identifiers, and comprehensive logging.

## Error Response Envelope

Every error response follows this canonical shape:

```json
{
  "code": 400,
  "errorCode": "BAD_REQUEST",
  "message": "Human-readable error message",
  "details": { "...additional context..." },
  "traceId": "M1ABC2DEF3G",
  "timestamp": "2026-01-23T12:30:00.000Z",
  "path": "/api/v1/resource",
  "correlationId": "M1ABC2DEF3G"
}
```

| Field           | Type             | Description                                                 |
|-----------------|------------------|-------------------------------------------------------------|
| `code`          | `number`         | HTTP status code                                            |
| `errorCode`     | `string`         | Stable machine-readable canonical error code identifier     |
| `message`       | `string`         | Human-readable error message                                |
| `details`       | `object \| null` | Additional error-specific information (optional)            |
| `traceId`       | `string`         | Request trace ID from `X-Request-ID` / correlation headers  |
| `timestamp`     | `string`         | ISO 8601 timestamp of when the error occurred               |
| `path`          | `string`         | The API endpoint that caused the error                      |
| `correlationId` | `string`         | Correlation ID for distributed request tracing              |

## Architecture

### Canonical Error Code Catalog

All error codes are defined in `src/common/constants/error-codes.ts` and re-exported through `src/common/dto/error-response.dto.ts` and `src/common/index.ts` for client consumption.

Error code categories include:
- **Base / HTTP Errors**: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `UNPROCESSABLE_ENTITY`, `RATE_LIMIT_EXCEEDED`, `INTERNAL_SERVER_ERROR`, `SERVICE_UNAVAILABLE`, `GATEWAY_TIMEOUT`, `TIMEOUT`, `INVALID_OPERATION`, `DEPENDENCY_FAILURE`
- **Validation**: `VALIDATION_ERROR`, `INVALID_INPUT`, `MISSING_REQUIRED_FIELD`, `INVALID_FORMAT`
- **Database / Prisma**: `DATABASE_ERROR`, `RECORD_NOT_FOUND`, `UNIQUE_CONSTRAINT_VIOLATION`, `FOREIGN_KEY_VIOLATION`, `VALUE_TOO_LONG`
- **Auth & API Keys**: `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `INVALID_TOKEN`, `API_KEY_NOT_FOUND`, `API_KEY_REVOKED`, `API_KEY_EXPIRED`, `API_KEY_INVALID`, `INSUFFICIENT_PERMISSIONS`, `SCOPE_REQUIRED`
- **Domain (Claims & Campaigns)**: `CLAIM_NOT_FOUND`, `CLAIM_ALREADY_CANCELLED`, `CLAIM_ALREADY_REISSUED`, `CAMPAIGN_NOT_FOUND`, `CAMPAIGN_FUNDING_CAP_EXCEEDED`, `CAMPAIGN_EXPIRED`, `SESSION_NOT_FOUND`, etc.
- **Integrations**: AI (`AI_SERVICE_UNAVAILABLE`, `AI_SERVICE_TIMEOUT`, etc.), Onchain (`ONCHAIN_TRANSACTION_FAILED`, `ONCHAIN_CONTRACT_ERROR`, etc.), Evidence (`EVIDENCE_UPLOAD_FAILED`, etc.), Webhooks (`WEBHOOK_DUPLICATE_EVENT`, `WEBHOOK_INVALID_SIGNATURE`, etc.)

### Single Global Exception Filter

All errors are handled by `AllExceptionsFilter` in `src/common/filters/http-exception.filter.ts`. It is registered via DI in `AppModule` using the `APP_FILTER` token, ensuring proper logger injection and consistent response transformation.

### Typed AppException

For domain logic where a specific canonical error code should be emitted, `AppException` is thrown:

```typescript
throw new AppException(
  ERROR_CODES.AI_SERVICE_UNAVAILABLE,
  503,
  'AI service is temporarily unavailable',
  { retryAfterSeconds: 30 }
);
```

### Request Trace ID

The `RequestIdInterceptor` in `src/common/interceptors/request-id.interceptor.ts` generates or propagates `X-Request-ID` headers. This ID becomes the `traceId` in error responses, enabling end-to-end request correlation.

## Error Types Handled

### HTTP Exceptions
All NestJS HTTP exceptions (BadRequest, Unauthorized, NotFound, Forbidden, etc.) are mapped to canonical codes and emitted within the standardized envelope.

### Prisma Database Errors
| Prisma Code | HTTP Status | Error Code                     | Message                          |
|-------------|-------------|--------------------------------|----------------------------------|
| `P2002`     | 409         | `UNIQUE_CONSTRAINT_VIOLATION`  | Unique constraint violation      |
| `P2025`     | 404         | `RECORD_NOT_FOUND`             | Record not found                 |
| `P2003`     | 400         | `FOREIGN_KEY_VIOLATION`        | Foreign key constraint violation |
| `P2000`     | 400         | `VALUE_TOO_LONG`               | Value too long for column        |

### Validation Errors
Class-validator errors return `422 Unprocessable Entity` with `errorCode: VALIDATION_ERROR` and structured `details.errors`.

### Generic Errors
Unknown exceptions return `500 Internal Server Error` with `errorCode: INTERNAL_SERVER_ERROR` and `error_type` in details. Stack traces are only included when `NODE_ENV=development`.

## Testing

### Unit and E2E Tests

```bash
# Unit tests for the canonical error catalog
npx jest src/common/constants/error-codes.spec.ts --verbose

# Unit tests for the exception filter
npx jest src/common/filters/all-exceptions.filter.spec.ts --verbose

# Unit tests for integration error codes
npx jest src/common/constants/integration-error-codes.spec.ts --verbose

# E2E error envelope tests
npx jest --config ./test/jest-e2e.json test/error-envelope.e2e-spec.ts --verbose

# E2E error handling tests
npx jest --config ./test/jest-e2e.json test/error-handling.e2e-spec.ts --verbose
```
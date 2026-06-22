# Global Error Handling and Consistent API Error Schema

## Overview

This implementation provides a standardized error handling mechanism across the entire backend application. All errors follow a consistent JSON envelope with `traceId` tracking and comprehensive logging.

## Error Response Envelope

Every error response follows this shape:

```json
{
  "code": 400,
  "message": "Human-readable error message",
  "details": { "...additional context..." },
  "traceId": "M1ABC2DEF3G",
  "timestamp": "2026-01-23T12:30:00.000Z",
  "path": "/api/v1/resource"
}
```

| Field       | Type             | Description                                       |
|-------------|------------------|---------------------------------------------------|
| `code`      | `number`         | HTTP status code                                  |
| `message`   | `string`         | Human-readable error message                      |
| `details`   | `object \| null` | Additional error-specific information (optional)  |
| `traceId`   | `string`         | Request trace ID from `X-Request-ID` header       |
| `timestamp` | `string`         | ISO 8601 timestamp of when the error occurred     |
| `path`      | `string`         | The API endpoint that caused the error            |

## Architecture

### Single Global Exception Filter

All errors are handled by `AllExceptionsFilter` in `src/common/filters/http-exception.filter.ts`. It is registered via DI in `AppModule` using the `APP_FILTER` token, which ensures it receives `LoggerService` injection.

### Request Trace ID

The `RequestIdInterceptor` in `src/common/interceptors/request-id.interceptor.ts` generates or propagates `X-Request-ID` headers. This ID becomes the `traceId` in error responses, enabling end-to-end request correlation.

## Error Types Handled

### HTTP Exceptions
All NestJS HTTP exceptions (BadRequest, Unauthorized, NotFound, Forbidden, etc.) are mapped to the envelope with the correct status code.

### Prisma Database Errors
| Prisma Code | HTTP Status | Message                         |
|-------------|-------------|---------------------------------|
| `P2002`     | 409         | Unique constraint violation     |
| `P2025`     | 404         | Record not found                |
| `P2003`     | 400         | Foreign key constraint violation|
| `P2000`     | 400         | Value too long for column       |

### Validation Errors
Class-validator errors return `422 Unprocessable Entity` with structured `details.errors`.

### Generic Errors
Unknown exceptions return `500 Internal Server Error` with `error_type` in details. Stack traces are only included when `NODE_ENV=development`.

## Testing

### Test Error Endpoints

The `TestErrorController` at `/api/v1/test-error/` provides endpoints for each error type:

| Endpoint                    | Method | Error Type           |
|-----------------------------|--------|----------------------|
| `/generic-error`            | GET    | Generic Error (500)  |
| `/bad-request`              | GET    | BadRequest (400)     |
| `/internal-server-error`    | GET    | InternalServer (500) |
| `/unauthorized`             | GET    | Unauthorized (401)   |
| `/forbidden`                | GET    | Forbidden (403)      |
| `/not-found`                | GET    | NotFound (404)       |
| `/validation-error`         | POST   | Validation (400/422) |
| `/prisma-error-simulation`  | GET    | Prisma P2002 (409)   |

### Running Tests

```bash
# Unit tests for the exception filter
npx jest src/common/filters/all-exceptions.filter.spec.ts --verbose

# E2E error handling tests
npx jest --config ./test/jest-e2e.json test/error-handling.e2e-spec.ts --verbose

# Shell script (start server first)
./test-errors.sh
```
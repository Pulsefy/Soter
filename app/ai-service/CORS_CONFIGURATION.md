# CORS Configuration Guide

## Overview

The Soter AI Service implements an allowlist-based CORS configuration to securely handle cross-origin requests from Vercel preview deployments and production frontends without widening CORS too much.

## Features

- **Allowlist-based origin validation**: Only configured origins are allowed
- **Vercel preview support**: Automatic support for `*.vercel.app` deployments
- **Sensitive endpoint protection**: Artifact access endpoints reject CORS entirely
- **Environment-aware configuration**: Different defaults for development vs production
- **Wildcard pattern matching**: Support for dynamic preview URLs

## Configuration

### Environment Variables

Configure CORS behavior using the following environment variables in your `.env` file:

```bash
# Comma-separated list of allowed production origins
CORS_ALLOWED_ORIGINS=https://example.com,https://app.example.com

# Allow Vercel preview deployments (default: true)
CORS_ALLOW_VERCEL_PREVIEWS=true

# Additional custom origins (comma-separated)
CORS_CUSTOM_ORIGINS=https://staging.example.com,https://partner.example.org
```

### Environment-Specific Behavior

#### Development
- Automatically allows `localhost:3000`, `localhost:3001`, and `127.0.0.1:3000`
- Vercel preview patterns enabled by default
- Custom origins can be added via `CORS_CUSTOM_ORIGINS`

#### Production
- Only origins from `CORS_ALLOWED_ORIGINS` are allowed
- Vercel preview patterns can be disabled via `CORS_ALLOW_VERCEL_PREVIEWS=false`
- Localhost is NOT allowed by default

#### Staging
- Inherits production behavior
- Can be customized with staging-specific origins

## Sensitive Endpoints

The following endpoints **reject CORS entirely** and require direct server-to-server communication:

- `/v1/ai/verification-artifacts/*`
- `/ai/verification-artifacts/*`

These endpoints handle sensitive verification artifacts and should only be called from trusted backend services, not browser clients.

## Usage Examples

### Production Configuration

```bash
# .env for production
APP_ENV=production
CORS_ALLOWED_ORIGINS=https://soter.example.com,https://admin.soter.example.com
CORS_ALLOW_VERCEL_PREVIEWS=true
CORS_CUSTOM_ORIGINS=
```

This allows:
- Production frontend: `https://soter.example.com`
- Admin panel: `https://admin.soter.example.com`
- All Vercel preview deployments: `https://*.vercel.app`

### Development Configuration

```bash
# .env for development
APP_ENV=development
CORS_ALLOWED_ORIGINS=
CORS_ALLOW_VERCEL_PREVIEWS=true
CORS_CUSTOM_ORIGINS=
```

This allows:
- Local development: `http://localhost:3000`, `http://localhost:3001`, `http://127.0.0.1:3000`
- Vercel preview deployments: `https://*.vercel.app`

### Strict Production Configuration

```bash
# .env for strict production (no previews)
APP_ENV=production
CORS_ALLOWED_ORIGINS=https://soter.example.com
CORS_ALLOW_VERCEL_PREVIEWS=false
CORS_CUSTOM_ORIGINS=
```

This allows:
- Only the production frontend: `https://soter.example.com`
- No Vercel preview deployments
- No custom origins

## Testing

Run the CORS tests to verify configuration:

```bash
pytest tests/test_cors.py -v
```

Tests cover:
- Configuration methods for allowed origins
- Origin validation with wildcard patterns
- CORS middleware behavior
- Sensitive endpoint protection
- Vercel preview deployment support
- Production origin allowlist

## Security Considerations

1. **Never use `*` as an allowed origin** in production
2. **Disable Vercel previews** in production if not needed
3. **Keep sensitive endpoints protected** - they reject CORS regardless of configuration
4. **Use HTTPS origins** in production environments
5. **Review allowlist regularly** and remove unused origins

## Troubleshooting

### CORS Errors in Browser

If you see CORS errors in the browser console:

1. Check the `Origin` header in the error
2. Verify the origin is in your allowlist configuration
3. Ensure the environment variable is set correctly
4. Check that Vercel preview support is enabled if using preview URLs

### Sensitive Endpoint 403 Errors

If you get 403 errors on artifact endpoints:

1. Ensure you're not calling from a browser (CORS is rejected for these endpoints)
2. Use server-to-server communication instead
3. Verify your backend is making direct API calls without Origin headers

### Preview Deployment Not Working

If Vercel preview deployments can't access the backend:

1. Check `CORS_ALLOW_VERCEL_PREVIEWS=true` is set
2. Verify the preview URL matches `https://*.vercel.app` pattern
3. Check logs for CORS rejection events

## Implementation Details

### Configuration Methods

The `Settings` class provides two key methods:

- `get_cors_allowed_origins()`: Returns the list of allowed origins based on configuration
- `is_origin_allowed(origin: str)`: Checks if a specific origin is allowed

### Middleware

The `cors_middleware` in `main.py`:

1. Checks if the request is for a sensitive endpoint
2. Validates the Origin header against the allowlist
3. Handles preflight OPTIONS requests
4. Adds appropriate CORS headers to responses
5. Logs CORS rejection events for monitoring

### Wildcard Pattern Matching

Vercel preview URLs use wildcard patterns:
- `https://*.vercel.app` matches any subdomain
- `https://*.vercel.app:*` matches any port

Patterns are converted to regex for matching:
- `*` becomes `[^\"]*` (matches any characters except quotes)

## Monitoring

CORS rejection events are logged with the following fields:

- `event`: "cors_rejected"
- `origin`: The rejected origin
- `path`: The requested path
- `reason`: Why it was rejected (e.g., "sensitive_endpoint")

Monitor these logs to detect:
- Misconfigured origins
- Unauthorized access attempts
- Issues with preview deployments

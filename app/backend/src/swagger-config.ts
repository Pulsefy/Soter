/**
 * swagger-config.ts
 *
 * Single source of truth for the DocumentBuilder configuration used by:
 *  - main.ts       (serves the live Swagger UI)
 *  - generate-spec.ts  (writes openapi/openapi.json)
 *  - check-spec-drift.ts (CI drift guard)
 *
 * Keeping the config here guarantees the three consumers are always in sync.
 */
import { DocumentBuilder } from '@nestjs/swagger';

const DESCRIPTION = `API documentation for Pulsefy/Soter platform - Emergency aid and verification system

## API Versioning

This API uses URI-based versioning. The current version is **v1**.

### Version Format
All endpoints are prefixed with the version number: \`/api/v1/...\`

### Supported Versions
| Version | Status | Description |
|---------|--------|-------------|
| v1 | Current | Active version with full support |

### Auth Schemes
Two authentication methods are supported:

| Scheme | Header | Description |
|--------|--------|-------------|
| JWT Bearer | \`Authorization: Bearer <token>\` | Issued JWTs for user/service auth |
| API Key | \`x-api-key: <key>\` | Long-lived API keys with scopes |

### API Key Scopes
| Scope | Description |
|-------|-------------|
| \`read\` | Read-only access to resources |
| \`write\` | Create and update resources |
| \`admin\` | Administrative operations including key management |
| \`webhook\` | Webhook delivery and management |

### Roles
| Role | Description |
|------|-------------|
| \`admin\` | Full platform access |
| \`operator\` | Can verify, approve, and manage claims/campaigns |
| \`ngo\` | Scoped to their own organization's resources |

### Deprecation Policy
- Deprecated endpoints will be marked with \`@Deprecated\` in the documentation
- Deprecated versions will be supported for at least 6 months after deprecation notice
- Clients will receive deprecation warnings via the \`Sunset\` HTTP header`;

export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Pulsefy/Soter API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
        description: 'Enter JWT token obtained from the authentication service',
      },
      'JWT-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header',
        description:
          'API key for external/service access. Scopes: read | write | admin | webhook',
      },
      'api-key',
    )
    .addServer('http://localhost:3000', 'Local Development')
    .addServer('https://api.pulsefy.dev', 'Staging')
    .addServer('https://api.pulsefy.com', 'Production')
    .build();
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { LoggerService } from './logger/logger.service';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import {
  buildCorsOptions,
  createCorsOriginValidator,
  createHelmetMiddleware,
  createRateLimiter,
} from './common/security/security.module';

async function bootstrap() {
  // Load environment variables
  const candidates = [
    join(process.cwd(), '.env'),
    join(process.cwd(), 'app', 'backend', '.env'),
    join(__dirname, '..', '.env'),
  ];

  const envPath = candidates.find(p => existsSync(p));
  if (envPath) {
    loadEnv({ path: envPath });
  }

  const app = await NestFactory.create(AppModule);

  // Get logger instance
  const logger = app.get(LoggerService);

  // Set custom logger
  app.useLogger(logger);

  // Enable shutdown hooks
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);

  // Security middleware (order matters)
  app.use(createHelmetMiddleware());
  app.use(createCorsOriginValidator(configService));
  app.enableCors(buildCorsOptions(configService));
  app.use(createRateLimiter(configService));

  // Global prefix
  app.setGlobalPrefix('api');

  // API Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'v',
  });

  // Register global request ID interceptor
  app.useGlobalInterceptors(new RequestIdInterceptor());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor(logger));

  // Swagger/OpenAPI Documentation
  const config = new DocumentBuilder()
    .setTitle('Pulsefy/Soter API')
    .setDescription(
      `API documentation for Pulsefy/Soter platform - Emergency aid and verification system

## API Versioning

This API uses URI-based versioning. The current version is **v1**.

### Version Format
All endpoints are prefixed with the version number: \`/api/v1/...\`

### Supported Versions
| Version | Status | Description |
|---------|--------|-------------|
| v1 | Current | Active version with full support |

### Deprecation Policy
- Deprecated endpoints will be marked with \`@Deprecated\` in the documentation
- Deprecated versions will be supported for at least 6 months after deprecation notice
- Clients will receive deprecation warnings via the \`Sunset\` HTTP header
- Migration guides will be provided for major version changes

### Future Versions
When new versions are released:
- New endpoints will be available at \`/api/v2/...\`, etc.
- Previous versions remain accessible during the deprecation period
- Clients should monitor the API documentation for version updates`,
    )
    .setVersion('1.0')
    .addTag('health', 'Health check endpoints (v1)')
    .addTag('aid', 'Aid request management (v1)')
    .addTag('verification', 'Identity and document verification (v1)')
    .addTag('app', 'Application root endpoints (v1)')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token',
      },
      'JWT-auth',
    )
    .addServer('http://localhost:3000/api/v1', 'Local Development (v1)')
    .addServer('https://api.pulsefy.dev/api/v1', 'Staging (v1)')
    .addServer('https://api.pulsefy.com/api/v1', 'Production (v1)')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Pulsefy API Docs',
    customfavIcon: 'https://pulsefy.com/favicon.ico',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
    },
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
  logger.log(`🔍 API Version: v1`);
}

void bootstrap();

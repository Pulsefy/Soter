import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { LoggerService } from './logger/logger.service';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { json, urlencoded } from 'express';

import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import {
  buildCorsOptions,
  createCorsOriginValidator,
  createHelmetMiddleware,
  createRateLimiter,
} from './common/security/security.module';
import { buildSwaggerConfig } from './swagger-config';

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

  // Add raw body parsing for webhook signature verification
  app.use(
    json({
      limit: '10mb',
      verify: (req: any, res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  const configService = app.get(ConfigService);

  // Security middleware (order matters)
  app.use(createHelmetMiddleware(configService));
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
      errorHttpStatusCode: 422,
    }),
  );

  // Global interceptors
  app.useGlobalInterceptors(new LoggingInterceptor(logger));

  // Swagger/OpenAPI Documentation
  // Config is sourced from swagger-config.ts — the same module used by
  // generate-spec.ts and check-spec-drift.ts — so the served UI always
  // matches the committed openapi/openapi.json artifact.
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Pulsefy API Docs',
    customfavIcon: 'https://pulsefy.com/favicon.ico',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  // Also expose the raw OpenAPI JSON at /api/docs-json for tooling
  // (the SwaggerModule already does this automatically at /api/docs-json).

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📚 Swagger UI:  http://localhost:${port}/api/docs`);
  logger.log(`📄 OpenAPI JSON: http://localhost:${port}/api/docs-json`);
  logger.log(`🔍 API Version: v1`);
}

void bootstrap();

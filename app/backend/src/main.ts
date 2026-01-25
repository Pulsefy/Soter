import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { LoggerService } from './logger/logger.service';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
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

  // Register global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

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

  // Global exception filters
  app.useGlobalFilters(new HttpExceptionFilter(logger));

  // Swagger/OpenAPI Documentation
  const config = new DocumentBuilder()
    .setTitle('Pulsefy/Soter API')
    .setDescription(
      'API documentation for Pulsefy/Soter platform - Emergency aid and verification system',
    )
    .setVersion('1.0')
    .addTag('health', 'Health check endpoints')
    .addTag('aid', 'Aid request management')
    .addTag('verification', 'Identity and document verification')
    .addTag('app', 'Application root endpoints')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token',
      },
      'JWT-auth',
    )
    .addServer('http://localhost:3000', 'Local Development')
    .addServer('https://api.pulsefy.dev', 'Staging')
    .addServer('https://api.pulsefy.com', 'Production')
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

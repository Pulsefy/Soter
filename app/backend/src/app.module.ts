import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AidModule } from './aid/aid.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { VerificationModule } from './verification/verification.module';
import { TestErrorModule } from './test-error/test-error.module';
import { LoggerModule } from './logger/logger.module';
import { AuditModule } from './audit/audit.module';
import { RequestCorrelationMiddleware } from './middleware/request-correlation.middleware';
import {
  SecurityModule,
  createRateLimiter,
} from './common/security/security.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { ObservabilityModule } from './observability/observability.module';
import { ClaimsModule } from './claims/claims.module';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { LoggerService } from './logger/logger.service';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: (() => {
        const candidates = [
          join(__dirname, '..', '.env'),
          join(process.cwd(), '.env'),
          join(process.cwd(), 'app', 'backend', '.env'),
        ];

        const existing = candidates.filter(p => existsSync(p));
        return existing.length > 0 ? existing : candidates;
      })(),
    }),

    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') ?? 'localhost',
          port: parseInt(configService.get<string>('REDIS_PORT') ?? '6379', 10),
        },
      }),
      inject: [ConfigService],
    }),

    LoggerModule,
    PrismaModule,
    HealthModule,
    AidModule,
    VerificationModule,
    AuditModule,
    SecurityModule,
    TestErrorModule,
    CampaignsModule,
    ObservabilityModule,
    ClaimsModule,
  ],

  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  constructor(
    private readonly configService: ConfigService,
    private readonly loggerService: LoggerService,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    // Request correlation middleware
    consumer.apply(RequestCorrelationMiddleware).forRoutes('*');

    // Rate limiter middleware
    consumer.apply(createRateLimiter(this.configService)).forRoutes('*');

    // Startup log
    this.loggerService.log(
      'AppModule initialized with structured logging, correlation IDs, and rate limiting',
      'AppModule',
    );
  }
}

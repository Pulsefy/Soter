import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
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
import { NotificationsModule } from './notifications/notifications.module';
import { JobsModule } from './jobs/jobs.module';
import { RequestCorrelationMiddleware } from './middleware/request-correlation.middleware';
import { SecurityModule } from './common/security/security.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { RolesGuard } from './auth/roles.guard';
import { ScopesGuard } from './api-keys/scopes.guard';
import { ObservabilityModule } from './observability/observability.module';
import { ClaimsModule } from './claims/claims.module';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { LoggerService } from './logger/logger.service';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { AnalyticsModule } from './analytics/analytics.module';
import { ThrottlerModule, ThrottlerStorageRedisService } from '@nestjs/throttler';
import { AidEscrowModule } from './onchain/aid-escrow.module';
import { CostAwareThrottlerGuard } from './common/guards/throttle.guard';
import { getThrottlerConfig } from './common/config/rate-limit.config';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { SessionModule } from './session/session.module';
import { CommonServicesModule } from './common/services/common-services.module';
import { EvidenceModule } from './evidence/evidence.module';
import { RetentionPolicyModule } from './retention-policy/retention-policy.module';
import { InvitesModule } from './orgs/invites.module';
import { AdminSearchModule } from './search/admin-search.module';
import { EntityLinkingModule } from './entity-linking/entity-linking.module';
import { DeploymentMetadataModule } from './deployment-metadata/deployment-metadata.module';
import { RedisModule } from '@liaoliaots/nestjs-redis';
import { AdaptiveRateLimitGuard } from './common/guards/adaptive-rate-limit.guard';
import { DeprecationInterceptor } from './common/interceptors/deprecation.interceptor';
import { SandboxModule } from './sandbox/sandbox.module';
import { CacheModule } from './common/cache/cache.module';
import { CacheResponseInterceptor } from './common/interceptors/cache-response.interceptor';

import { WebhooksModule } from 'src/webhooks.module';
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
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: {
            age: 3600, // keep for 1 hour
            count: 1000,
          },
          removeOnFail: {
            age: 24 * 3600, // keep for 24 hours
            count: 5000,
          },
        },
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),

    LoggerModule,
    PrismaModule,
    CacheModule,
    HealthModule,
    AidModule,
    VerificationModule,
    AuditModule,
    SecurityModule,
    TestErrorModule,
    CampaignsModule,
    ObservabilityModule,
    ClaimsModule,
    NotificationsModule,
    JobsModule,
    AnalyticsModule,
    AidEscrowModule,
    ApiKeysModule,
    SessionModule,
    CommonServicesModule,
    EvidenceModule,
    RetentionPolicyModule,
    InvitesModule,
    AdminSearchModule,
    EntityLinkingModule,
    DeploymentMetadataModule,
    SandboxModule,
    WebhooksModule,
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        config: {
          host: configService.get<string>('REDIS_HOST') ?? 'localhost',
          port: parseInt(configService.get<string>('REDIS_PORT') ?? '6379', 10),
        },
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisHost = configService.get<string>('REDIS_HOST') ?? 'localhost';
        const redisPort = parseInt(
          configService.get<string>('REDIS_PORT') ?? '6379',
          10,
        );

        // Try to use Redis storage for multi-instance compatibility
        // Falls back to in-memory storage if Redis is unavailable
        try {
          const { createClient } = await import('redis');
          const client = createClient({
            socket: {
              host: redisHost,
              port: redisPort,
              reconnectStrategy: (retries: number) => {
                if (retries > 10) {
                  console.warn(
                    'ThrottlerModule: Failed to connect to Redis after 10 retries, falling back to in-memory storage',
                  );
                  return new Error(
                    'Max retries exceeded for ThrottlerModule Redis',
                  );
                }
                return retries * 50;
              },
            },
          });

          await client.connect();

          return {
            throttlers: getThrottlerConfig(),
            storage: new ThrottlerStorageRedisService(client),
          };
        } catch (error) {
          console.warn(
            'ThrottlerModule: Redis unavailable, using in-memory storage',
            error instanceof Error ? error.message : error,
          );
          // Fall back to in-memory storage for local development
          return {
            throttlers: getThrottlerConfig(),
          };
        }
      },
      inject: [ConfigService],
    }),
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
      useClass: ApiKeyGuard, // runs first — authenticates and sets request.user
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard, // runs second — checks request.user.role against @Roles()
    },
    {
      provide: APP_GUARD,
      useClass: ScopesGuard, // runs third — checks request.user.scopes against @Scopes()
    },
    {
      provide: APP_GUARD,
      useClass: AdaptiveRateLimitGuard, // Adaptive rate limiting using Redis
    },
    {
      provide: APP_GUARD,
      useClass: CostAwareThrottlerGuard, // NestJS Throttler with cost-aware per-endpoint limits
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: DeprecationInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheResponseInterceptor,
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

    // Startup log
    this.loggerService.log(
      'AppModule initialized with structured logging, correlation IDs, and rate limiting',
      'AppModule',
    );
  }
}

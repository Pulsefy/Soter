import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Redis from 'ioredis';

type CheckStatus = 'up' | 'down' | 'skipped';

interface HealthCheckResult {
  status: CheckStatus;
  details?: Record<string, unknown>;
}

interface DependencyCheckResult {
  status: 'up' | 'down';
  details?: Record<string, unknown>;
}

export interface DependencyProbeResponse {
  status: 'ready' | 'not_ready';
  ready: boolean;
  service: 'backend';
  timestamp: string;
  checks: {
    redis: DependencyCheckResult;
    providerConfiguration: DependencyCheckResult;
    filesystem: DependencyCheckResult;
  };
}

export interface LivenessResponse {
  status: 'ok';
  service: 'backend';
  version: string;
  environment: string;
  timestamp: string;
  checks: {
    process: HealthCheckResult;
  };
}

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  ready: boolean;
  service: 'backend';
  timestamp: string;
  checks: {
    database: HealthCheckResult;
    stellarRpc: HealthCheckResult;
  };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly prisma: PrismaService,
  ) {}

  check() {
    const version = process.env.npm_package_version ?? '0.0.0';

    return {
      status: 'ok',
      service: 'backend',
      version,
      environment: this.configService.get<string>('NODE_ENV') ?? 'development',
      timestamp: new Date().toISOString(),
    };
  }

  getLiveness(): LivenessResponse {
    const uptimeSeconds = Math.floor(process.uptime());
    const memory = process.memoryUsage();

    return {
      status: 'ok',
      service: 'backend',
      version: process.env.npm_package_version ?? '0.0.0',
      environment: this.configService.get<string>('NODE_ENV') ?? 'development',
      timestamp: new Date().toISOString(),
      checks: {
        process: {
          status: 'up',
          details: {
            pid: process.pid,
            uptimeSeconds,
            nodeVersion: process.version,
            rssBytes: memory.rss,
            heapUsedBytes: memory.heapUsed,
          },
        },
      },
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const [database, stellarRpc] = await Promise.all([
      this.checkDatabase(),
      this.checkStellarRpc(),
    ]);

    const stellarRequired = this.isEnabled(
      this.configService.get<string>('HEALTHCHECK_STELLAR_REQUIRED'),
    );

    const dependenciesReady =
      database.status === 'up' &&
      (!stellarRequired || stellarRpc.status === 'up');

    return {
      status: dependenciesReady ? 'ready' : 'not_ready',
      ready: dependenciesReady,
      service: 'backend',
      timestamp: new Date().toISOString(),
      checks: {
        database,
        stellarRpc,
      },
    };
  }

  async getDependencyProbe(): Promise<DependencyProbeResponse> {
    const [redis, providerConfiguration, filesystem] = await Promise.all([
      this.checkRedisConnectivity(),
      this.checkProviderConfiguration(),
      this.checkFilesystemAccess(),
    ]);

    const ready =
      redis.status === 'up' &&
      providerConfiguration.status === 'up' &&
      filesystem.status === 'up';

    return {
      status: ready ? 'ready' : 'not_ready',
      ready,
      service: 'backend',
      timestamp: new Date().toISOString(),
      checks: {
        redis,
        providerConfiguration,
        filesystem,
      },
    };
  }

  logHealthCheck(requestId?: string) {
    this.logger.log('Health check endpoint accessed', 'HealthService', {
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  logErrorAttempt(requestId?: string) {
    this.logger.warn('Error endpoint triggered for testing', 'HealthService', {
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  private async checkDatabase(): Promise<HealthCheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'up',
        details: {
          connected: true,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown database error';

      this.logger.error(
        'Database readiness check failed',
        undefined,
        'HealthService',
        {
          error: message,
        },
      );

      return {
        status: 'down',
        details: {
          connected: false,
          error: message,
        },
      };
    }
  }

  private async checkRedisConnectivity(): Promise<DependencyCheckResult> {
    let client: Redis | null = null;

    try {
      const redisUrl = this.configService.get<string>('REDIS_URL');
      const redisHost = this.configService.get<string>('REDIS_HOST') ?? 'localhost';
      const redisPort = parseInt(
        this.configService.get<string>('REDIS_PORT') ?? '6379',
        10,
      );

      client = redisUrl
        ? new Redis(redisUrl)
        : new Redis({ host: redisHost, port: redisPort });

      await client.ping();

      return {
        status: 'up',
        details: {
          connected: true,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Redis error';

      this.logger.warn(
        'Redis dependency check failed',
        undefined,
        'HealthService',
        {
          error: message,
        },
      );

      return {
        status: 'down',
        details: {
          connected: false,
        },
      };
    } finally {
      if (client) {
        try {
          await client.quit();
        } catch {
          client.disconnect();
        }
      }
    }
  }

  private checkProviderConfiguration(): DependencyCheckResult {
    const verificationMode =
      this.configService.get<string>('VERIFICATION_MODE')?.trim().toLowerCase() ||
      'mock';
    const aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL');
    const openAIKey = this.configService.get<string>('OPENAI_API_KEY');
    const aiRequired = verificationMode === 'ai';

    const ready = !aiRequired || (!!aiServiceUrl && !!openAIKey);

    return {
      status: ready ? 'up' : 'down',
      details: {
        verificationMode,
        aiServiceUrlConfigured: Boolean(aiServiceUrl),
        openAIKeyConfigured: Boolean(openAIKey),
        required: aiRequired,
      },
    };
  }

  private async checkFilesystemAccess(): Promise<DependencyCheckResult> {
    const tempDirectory = tmpdir();
    const tempFile = join(
      tempDirectory,
      `soter-health-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
    );

    try {
      await fs.writeFile(tempFile, 'ok', { encoding: 'utf8' });
      await fs.readFile(tempFile, 'utf8');

      return {
        status: 'up',
        details: {
          tempDirectoryAccessible: true,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown filesystem error';

      this.logger.warn(
        'Filesystem dependency check failed',
        undefined,
        'HealthService',
        {
          error: message,
        },
      );

      return {
        status: 'down',
        details: {
          tempDirectoryAccessible: false,
        },
      };
    } finally {
      try {
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors; the probe is best-effort for transient temp access
      }
    }
  }

  private async checkStellarRpc(): Promise<HealthCheckResult> {
    const rpcUrl = this.configService.get<string>('STELLAR_RPC_URL');

    if (!rpcUrl) {
      return {
        status: 'skipped',
        details: {
          reason: 'STELLAR_RPC_URL not configured',
        },
      };
    }

    const timeoutMs = Number(
      this.configService.get<string>('HEALTHCHECK_STELLAR_TIMEOUT_MS') ??
        '3000',
    );

    try {
      const response = await fetch(rpcUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(
          Number.isFinite(timeoutMs) ? timeoutMs : 3000,
        ),
      });

      if (!response.ok) {
        return {
          status: 'down',
          details: {
            connected: false,
            statusCode: response.status,
          },
        };
      }

      return {
        status: 'up',
        details: {
          connected: true,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown Stellar RPC error';

      this.logger.warn('Stellar RPC readiness check failed', 'HealthService', {
        error: message,
        rpcUrl,
      });

      return {
        status: 'down',
        details: {
          connected: false,
          error: message,
        },
      };
    }
  }

  private isEnabled(value?: string): boolean {
    if (!value) {
      return false;
    }

    return value.trim().toLowerCase() === 'true';
  }
}

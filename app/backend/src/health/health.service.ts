import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.adapter';
import {
  ProviderHealthRegistryService,
  ProviderHealthSnapshot,
} from './provider-health-registry.service';

export type CheckStatus = 'up' | 'down' | 'skipped';

export interface HealthCheckResult {
  status: CheckStatus;
  details?: Record<string, unknown>;
}

export interface DeploymentMetadata {
  gitSha: string;
  environment: string;
  buildTimestamp: string;
}

export interface LivenessResponse {
  status: 'ok';
  service: 'backend';
  version: string;
  environment: string;
  timestamp: string;
  deployment: DeploymentMetadata;
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
  providers?: Record<string, ProviderHealthSnapshot>;
}

export interface ProviderHealthResponse {
  timestamp: string;
  providers: Record<string, ProviderHealthSnapshot>;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly prisma: PrismaService,
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
    private readonly providerHealthRegistry: ProviderHealthRegistryService,
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
      deployment: this.getDeploymentMetadata(),
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

    const providers = this.providerHealthRegistry.getAllStatuses();

    return {
      status: dependenciesReady ? 'ready' : 'not_ready',
      ready: dependenciesReady,
      service: 'backend',
      timestamp: new Date().toISOString(),
      checks: {
        database,
        stellarRpc,
      },
      providers,
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

  /**
   * Deployment metadata linking this running backend instance to the CI/CD
   * build that produced it (git sha, environment, build timestamp).
   * Populated from env vars set at build/deploy time; falls back to safe
   * 'unknown' defaults so the endpoint never errors when they're absent
   * (e.g. local development).
   */
  private getDeploymentMetadata(): DeploymentMetadata {
    return {
      gitSha: this.configService.get<string>('GIT_SHA') ?? 'unknown',
      environment: this.configService.get<string>('NODE_ENV') ?? 'development',
      buildTimestamp:
        this.configService.get<string>('BUILD_TIMESTAMP') ?? 'unknown',
    };
  }

  private isEnabled(value?: string): boolean {
    if (!value) {
      return false;
    }

    return value.trim().toLowerCase() === 'true';
  }

  async checkOnchainContract(): Promise<{
    status: 'up' | 'down';
    latencyMs: number;
    metadata?: { version: string; name: string };
    error?: string;
  }> {
    const startTime = Date.now();
    try {
      const contractMetadata = await this.onchainAdapter.getContractMetadata();
      const latency = Date.now() - startTime;
      return {
        status: 'up',
        latencyMs: latency,
        metadata: {
          version: contractMetadata.version,
          name: contractMetadata.name,
        },
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        'On-chain contract health check failed',
        undefined,
        'HealthService',
        { error: errorMsg },
      );
      return {
        status: 'down',
        latencyMs: latency,
        error: errorMsg,
      };
    }
  }

  /**
   * Returns a snapshot of all known provider health statuses.
   * No sensitive details are included (issue #770).
   */
  getProviderHealth(): ProviderHealthResponse {
    return {
      timestamp: new Date().toISOString(),
      providers: this.providerHealthRegistry.getAllStatuses(),
    };
  }

  async getDiagnosticsExport() {
    const liveness = this.getLiveness();
    const readiness = await this.getReadiness();
    const rpcUrl =
      this.configService.get<string>('STELLAR_RPC_URL') ??
      'https://soroban-testnet.stellar.org';

    const rawBundle = {
      metadata: {
        timestamp: new Date().toISOString(),
        appVersion: liveness.version,
        environment: liveness.environment,
        service: 'soter-backend',
        uptimeSeconds: Math.floor(process.uptime()),
        platform: process.platform,
        nodeVersion: process.version,
      },
      metadataEndpoint: '/health/metadata',
      appState: {
        database: readiness.checks.database,
        memory: liveness.checks.process.details,
      },
      queueHealth: {
        status: 'active',
        queueType: 'BullMQ',
      },
      walletNetworkStatus: {
        stellarRpc: readiness.checks.stellarRpc,
        network: rpcUrl.includes('testnet') ? 'testnet' : 'mainnet',
      },
      recentErrors: [],
      sanitized: true,
    };

    return this.sanitizeDiagnostics(rawBundle);
  }

  private sanitizeDiagnostics<T>(data: T): T {
    if (data === null || data === undefined) return data;
    if (typeof data === 'string') {
      let str = data.replace(/\bS[A-Z0-9]{55}\b/g, '[REDACTED]');
      str = str.replace(
        /Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_=]*/gi,
        'Bearer [REDACTED]',
      );
      return str as T;
    }
    if (typeof data !== 'object') return data;
    if (Array.isArray(data))
      return data.map(item => this.sanitizeDiagnostics(item)) as unknown as T;

    const sensitiveKeys = new Set([
      'password',
      'token',
      'secret',
      'authorization',
      'apikey',
      'api_key',
      'privatekey',
      'private_key',
      'email',
      'seed',
    ]);
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (sensitiveKeys.has(k.toLowerCase())) {
        result[k] = '[REDACTED]';
      } else {
        result[k] = this.sanitizeDiagnostics(v);
      }
    }
    return result as T;
  }
}

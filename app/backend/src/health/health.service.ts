import { Injectable, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.adapter';

type CheckStatus = 'up' | 'down' | 'skipped';

interface HealthCheckResult {
  status: CheckStatus;
  details?: Record<string, unknown>;
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

export interface OnchainProbeResponse {
  status: 'ok' | 'error';
  timestamp: string;
  latencyMs: number;
  contractId?: string;
  rpcUrl?: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter?: OnchainAdapter,
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

  private isEnabled(value?: string): boolean {
    if (!value) {
      return false;
    }

    return value.trim().toLowerCase() === 'true';
  }

  async probeOnchain(): Promise<OnchainProbeResponse> {
    const startTime = Date.now();
    const contractId = this.configService.get<string>('SOROBAN_CONTRACT_ID');
    const rpcUrl = this.configService.get<string>(
      'STELLAR_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );

    // If no adapter or contract ID, return skipped status
    if (!this.onchainAdapter || !contractId) {
      const latencyMs = Date.now() - startTime;
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        latencyMs,
        contractId,
        rpcUrl,
      };
    }

    try {
      const timeoutMs = Number(
        this.configService.get<string>('HEALTHCHECK_ONCHAIN_TIMEOUT_MS') ??
          '5000',
      );

      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Onchain probe timeout')),
          Number.isFinite(timeoutMs) ? timeoutMs : 5000,
        ),
      );

      // Use a dummy token address for the read-only call
      // This allows us to verify RPC connectivity without having a real token
      const dummyToken =
        'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ';

      // Perform a read-only call to get aid package count
      // This doesn't modify state and only reads contract data
      const probePromise = this.onchainAdapter.getAidPackageCount({
        token: dummyToken,
      });

      // Race between the probe and timeout
      await Promise.race([probePromise, timeoutPromise]);

      const latencyMs = Date.now() - startTime;

      this.logger.log('Onchain probe successful', 'HealthService', {
        latencyMs,
        contractId,
      });

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        latencyMs,
        contractId,
        rpcUrl,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const message =
        error instanceof Error ? error.message : 'Unknown onchain error';

      this.logger.warn('Onchain probe failed', 'HealthService', {
        error: message,
        latencyMs,
        contractId,
        rpcUrl,
      });

      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        latencyMs,
        contractId,
        rpcUrl,
      };
    }
  }
}

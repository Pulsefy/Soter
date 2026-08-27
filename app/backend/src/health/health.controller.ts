import { Controller, Get, Req, Res, Version, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiInternalServerErrorResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { RequestWithRequestId } from '../middleware/request-correlation.middleware';
import { HealthService } from './health.service';
import { LivenessResponse, ReadinessResponse } from './health.service';
import { API_VERSIONS } from '../common/constants/api-version.constants';
import { Public } from '../common/decorators/public.decorator';
import { SkipThrottle } from '../common/decorators/skip-throttle.decorator';
import { MetadataService } from './metadata.service';
import { MetadataResponse } from './metadata.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly metadataService: MetadataService,
  ) {}

  @Public()
  @SkipThrottle()
  @Get()
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'Check system liveness and basic service metadata',
    description:
      'Returns process liveness details and service metadata. Part of v1 API.',
  })
  @ApiOkResponse({
    description: 'Service is alive and basic metadata retrieved.',
    schema: {
      example: {
        status: 'ok',
        service: 'backend',
        version: '1.0.0',
        environment: 'production',
        timestamp: '2025-02-23T12:00:00.000Z',
        deployment: {
          gitSha: 'a1b2c3d',
          environment: 'production',
          buildTimestamp: '2025-02-23T10:00:00.000Z',
        },
      },
    },
  })
  check(@Req() req: RequestWithRequestId): LivenessResponse {
    const requestId = req.requestId;
    this.healthService.logHealthCheck(requestId);

    return this.healthService.getLiveness();
  }

  @Public()
  @SkipThrottle()
  @Get('live')
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Returns process-level liveness information. Intended for orchestration liveness checks.',
  })
  @ApiOkResponse({
    description: 'Process is alive.',
    schema: {
      example: {
        status: 'ok',
        service: 'backend',
        version: '1.0.0',
        environment: 'production',
        timestamp: '2025-02-23T12:00:00.000Z',
        deployment: {
          gitSha: 'a1b2c3d',
          environment: 'production',
          buildTimestamp: '2025-02-23T10:00:00.000Z',
        },
        checks: {
          process: { status: 'up' },
        },
      },
    },
  })
  liveness(): LivenessResponse {
    return this.healthService.getLiveness();
  }

  @Public()
  @SkipThrottle()
  @Get('ready')
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Returns dependency readiness (database and optional Stellar RPC). Responds 503 when not ready.',
  })
  @ApiOkResponse({
    description: 'Service is ready to serve traffic.',
    schema: {
      example: {
        ready: true,
        dependencies: {
          database: 'up',
          stellar: 'up',
        },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'Service is not ready (one or more dependencies are down).',
    schema: {
      example: {
        ready: false,
        dependencies: {
          database: 'down',
          stellar: 'up',
        },
      },
    },
  })
  async readiness(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessResponse> {
    const readiness = await this.healthService.getReadiness();

    if (!readiness.ready) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return readiness;
  }

  @Get('error')
  @SkipThrottle()
  @Version(API_VERSIONS.V1)
  @ApiOperation({ summary: 'Trigger an error for testing' })
  @ApiInternalServerErrorResponse({
    description: 'Test error triggered successfully.',
  })
  triggerError(@Req() req: RequestWithRequestId) {
    const requestId = req.requestId;

    // Log the error attempt
    this.healthService.logErrorAttempt(requestId);

    // Throw an error to test exception handling
    throw new Error('This is a test error for logging demonstration');
  }

  @Get('onchain')
  @SkipThrottle()
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'On-chain contract health probe (internal use)',
    description:
      'Performs a read-only contract call to verify connectivity to Soroban RPC and contract functionality. Requires authentication.',
  })
  @ApiOkResponse({
    description: 'On-chain health check completed successfully',
  })
  @ApiServiceUnavailableResponse({
    description: 'On-chain health check failed',
  })
  async onchainHealth(@Res({ passthrough: true }) res: Response) {
    const result = await this.healthService.checkOnchainContract();
    if (result.status === 'down') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }

  @Public()
  @Get('diagnostics')
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'Export support diagnostics bundle',
    description:
      'Returns a support-friendly diagnostics export containing sanitized application state, queue health, wallet/network status, error logs, timestamps, and app version metadata.',
  })
  async exportDiagnostics() {
    return this.healthService.getDiagnosticsExport();
  }

  @Public()
  @SkipThrottle()
  @Get('metadata')
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'Safe service metadata for debugging and integration checks',
    description:
      'Returns active providers, model versions, and capability flags. No secrets or private credentials are included. Suitable for linking from health probes and diagnostics surfaces.',
  })
  @ApiOkResponse({
    description: 'Service metadata with providers, models, and capability flags.',
    schema: {
      example: {
        service: 'soter-backend',
        version: '0.0.1',
        environment: 'development',
        timestamp: '2025-02-23T12:00:00.000Z',
        providers: {
          onchain: { adapter: 'mock', network: 'testnet' },
          ai: {
            active: 'none',
            models: { openai: 'gpt-4o-mini', groq: 'llama-3.3-70b-versatile' },
          },
        },
        capabilities: {
          caching: true,
          rateLimiting: true,
          verification: true,
          onchainEscrow: true,
          deterministicMode: false,
          redisEnabled: true,
        },
      },
    },
  })
  getMetadata(): MetadataResponse {
    return this.metadataService.getMetadata();
  }
}

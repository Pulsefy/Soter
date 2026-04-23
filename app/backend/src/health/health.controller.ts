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
import { Throttle } from '@nestjs/throttler';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @Throttle({ default: { ttl: 60, limit: 100 } }) // Limit to 100 requests per minute for this endpoint
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
        version: '1.0.0',
        timestamp: '2025-02-23T12:00:00.000Z',
      },
    },
  })
  check(@Req() req: RequestWithRequestId): LivenessResponse {
    const requestId = req.requestId;
    this.healthService.logHealthCheck(requestId);

    return this.healthService.getLiveness();
  }

  @Public()
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
        uptime: '2d 5h 12m 30s',
      },
    },
  })
  liveness(): LivenessResponse {
    return this.healthService.getLiveness();
  }

  @Public()
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
}

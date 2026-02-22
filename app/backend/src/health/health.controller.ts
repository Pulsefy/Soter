import {
  Controller,
  Get,
  Req,
  Res,
  Version,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { RequestWithRequestId } from '../middleware/request-correlation.middleware';
import { HealthService } from './health.service';
import { LivenessResponse, ReadinessResponse } from './health.service';
import { API_VERSIONS } from '../common/constants/api-version.constants';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'Check system liveness and basic service metadata',
    description:
      'Returns process liveness details and service metadata. Part of v1 API.',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is alive',
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
  @ApiResponse({
    status: 200,
    description: 'Process is alive',
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
  @ApiResponse({
    status: 200,
    description: 'Service is ready to serve traffic',
  })
  @ApiResponse({
    status: 503,
    description: 'Service is not ready',
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
  @ApiResponse({ status: 500, description: 'Internal server error' })
  triggerError(@Req() req: RequestWithRequestId) {
    const requestId = req.requestId;

    // Log the error attempt
    this.healthService.logErrorAttempt(requestId);

    // Throw an error to test exception handling
    throw new Error('This is a test error for logging demonstration');
  }
}

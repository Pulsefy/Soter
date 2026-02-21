import { Controller, Get, Req, Version } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RequestWithRequestId } from '../middleware/request-correlation.middleware';
import { HealthService } from './health.service';
import { API_VERSIONS } from '../common/constants/api-version.constants';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'Check system health',
    description: 'Returns the current health status of the API. Part of v1 API.',
  })
  @ApiResponse({
    status: 200,
    description: 'System is healthy',
    schema: {
      example: {
        status: 'healthy',
        version: 'v1',
        timestamp: '2025-01-23T10:00:00.000Z',
      },
    },
  })
  check(@Req() req: RequestWithRequestId) {
    // Access the request ID from the request object
    const requestId = req.requestId;

    // Log with request correlation
    this.healthService.logHealthCheck(requestId);

    return this.healthService.check();
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

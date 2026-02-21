import { Controller, Get, Version } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { API_VERSIONS } from './common/constants/api-version.constants';
import { Public } from './common/decorators/public.decorator';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'Root endpoint (v1)',
    description: 'Returns a welcome message and API information. Part of v1 API.',
  })
  @ApiResponse({
    status: 200,
    description: 'Welcome message returned successfully',
    schema: {
      example: {
        message: 'Welcome to Pulsefy/Soter API',
        version: 'v1',
        docs: '/api/docs',
      },
    },
  })
  getHello() {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'backend' };
  }
}

import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JobsMonitorService } from './jobs-monitor.service';

@ApiTags('Jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsMonitorService: JobsMonitorService) {}

  @ApiOperation({ summary: 'Get status of all background job queues' })
  @Get(['status', 'health'])
  async getStatus() {
    return this.jobsMonitorService.getStatus();
  }
}

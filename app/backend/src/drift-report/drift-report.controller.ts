import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import { DriftReportService } from './drift-report.service';
import type { DriftReport } from './drift-report.service';

@ApiTags('Drift Report')
@Controller('drift-report')
export class DriftReportController {
  private readonly logger = new Logger(DriftReportController.name);

  constructor(private readonly driftReportService: DriftReportService) {}

  @Post()
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate contract drift report (admin only)',
    description:
      'Compares configured contract metadata, deployed registry values, and ' +
      'observed on-chain behaviour to surface contract drift. Returns both ' +
      'machine-readable JSON and human-readable text.',
  })
  @ApiProduces('application/json')
  @ApiOkResponse({
    description: 'Drift report generated successfully.',
    schema: {
      type: 'object',
      properties: {
        json: {
          type: 'object',
          description: 'Machine-readable drift report',
        },
        text: {
          type: 'string',
          description: 'Human-readable drift report',
        },
      },
    },
  })
  async generateReport(): Promise<{ json: DriftReport; text: string }> {
    this.logger.log('Admin triggered drift report generation');
    const report = await this.driftReportService.generateReport();
    const text = this.driftReportService.generateHumanReadable(report);
    return { json: report, text };
  }

  @Get('status')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get cached drift report status (admin only)',
    description:
      'Returns the last cached drift report summary without re-querying on-chain.',
  })
  @ApiOkResponse({ description: 'Cached drift report status.' })
  async getStatus(): Promise<{
    overallStatus: string;
    totalContracts: number;
    configMismatches: number;
    missingDeployments: number;
  }> {
    this.logger.log('Admin requested drift report status');
    const report = await this.driftReportService.generateReport();
    return {
      overallStatus: report.overallStatus,
      totalContracts: report.totalContracts,
      configMismatches: report.configMismatches.length,
      missingDeployments: report.missingDeployments.length,
    };
  }
}

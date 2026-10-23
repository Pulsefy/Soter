import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import {
  OrphanedArtifactsService,
  OrphanReport,
  OrphanScanResult,
} from './orphaned-artifacts.service';

@ApiTags('Orphaned Evidence Artifacts')
@ApiBearerAuth('JWT-auth')
@Controller('evidence/orphans')
export class OrphanedArtifactsController {
  constructor(
    private readonly orphanedArtifactsService: OrphanedArtifactsService,
  ) {}

  @Get('report')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get orphaned artifacts report for admin',
    description:
      'Identifies artifacts with no corresponding claim or verification record past a grace period. ' +
      'Returns total counts, total size in bytes, and breakdown of flagged/unflagged items.',
  })
  @ApiQuery({
    name: 'gracePeriodHours',
    required: false,
    type: Number,
    description: 'Grace period in hours (defaults to 24 or server config)',
  })
  @ApiQuery({
    name: 'orgId',
    required: false,
    type: String,
    description: 'Optional organization filter',
  })
  @ApiOkResponse({
    description: 'Orphan report retrieved successfully.',
  })
  async getReport(
    @Query('gracePeriodHours') gracePeriodHours?: string,
    @Query('orgId') orgId?: string,
  ): Promise<OrphanReport> {
    const hours = gracePeriodHours ? parseInt(gracePeriodHours, 10) : undefined;
    return this.orphanedArtifactsService.getOrphanReport({
      gracePeriodHours: hours && !isNaN(hours) ? hours : undefined,
      orgId,
    });
  }

  @Post('scan')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Trigger orphaned artifact detection and review flagging (admin only)',
    description:
      'Runs the detection job. When dryRun is true, reports identified orphans without modifying records. ' +
      'When dryRun is false, flags orphaned artifacts for review (never deleting outright).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        dryRun: {
          type: 'boolean',
          description: 'If true, simulates scan without updating database',
          example: true,
        },
        gracePeriodHours: {
          type: 'number',
          description: 'Grace period in hours',
          example: 24,
        },
        orgId: {
          type: 'string',
          description: 'Optional organization filter',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Scan executed successfully.',
  })
  async triggerScan(
    @Body('dryRun') dryRun?: boolean,
    @Body('gracePeriodHours') gracePeriodHours?: number,
    @Body('orgId') orgId?: string,
  ): Promise<OrphanScanResult> {
    return this.orphanedArtifactsService.processOrphanedArtifacts({
      dryRun,
      gracePeriodHours,
      orgId,
    });
  }

  @Delete(':id')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete reviewed orphaned artifact (admin only)',
    description:
      'Permanently removes an orphaned artifact and its underlying storage after it has been flagged for review.',
  })
  @ApiOkResponse({
    description: 'Reviewed artifact deleted successfully.',
  })
  async deleteReviewed(
    @Param('id') id: string,
    @Request() req: ExpressRequest,
  ) {
    const adminId = req.user?.apiKeyId || req.user?.authType || 'admin';
    return this.orphanedArtifactsService.deleteReviewedOrphan(id, adminId);
  }
}

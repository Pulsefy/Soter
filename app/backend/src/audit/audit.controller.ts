import { Controller, Get, Query, Res, Version } from '@nestjs/common';
import { Response } from 'express';
import { AuditService, AuditQuery, ExportAuditQuery } from './audit.service';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('Audit')
@ApiBearerAuth('JWT-auth')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Version('1')
  @ApiOperation({
    summary: 'Query audit logs',
    description:
      'Retrieves a filtered list of audit logs based on entity, actor, or time range.',
  })
  @ApiOkResponse({ description: 'Audit logs retrieved successfully.' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiQuery({ name: 'entity', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiQuery({ name: 'startTime', required: false, description: 'ISO string' })
  @ApiQuery({ name: 'endTime', required: false, description: 'ISO string' })
  async getLogs(@Query() query: AuditQuery) {
    return this.auditService.findLogs(query);
  }

  @Get('export')
  @Version('1')
  @ApiOperation({
    summary: 'Export anonymized audit logs',
    description:
      'Exports anonymized audit logs as JSON or CSV with pagination and date-range filtering. Sensitive actor and entity IDs are replaced with deterministic SHA-256 hashes.',
  })
  @ApiOkResponse({ description: 'Audit logs exported successfully.' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['json', 'csv'],
    description: 'Export format (default: json)',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Start date (ISO string)',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'End date (ISO string)',
  })
  @ApiQuery({
    name: 'entity',
    required: false,
    description: 'Filter by entity type',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Items per page (default: 50, max: 200)',
  })
  async exportLogs(
    @Query() query: ExportAuditQuery & { format?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auditService.exportLogs(query);

    res.setHeader('X-Total-Count', String(result.total));
    res.setHeader('X-Page', String(result.page));
    res.setHeader('X-Limit', String(result.limit));

    if (query.format === 'csv') {
      const csv = this.auditService.buildCsv(result.data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="audit-export-${Date.now()}.csv"`,
      );
      return csv;
    }

    return result;
  }
}

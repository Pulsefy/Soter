import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  Version,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBody,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ExportCampaignsQueryDto } from './dto/export-campaigns.dto';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { Roles } from 'src/auth/roles.decorator';
import { AppRole } from 'src/auth/app-role.enum';
import { Throttle } from '@nestjs/throttler';
import { OrgOwnershipGuard } from '../common/guards/org-ownership.guard';
import { CancelAndReissueService } from '../claims/cancel-and-reissue.service';

@ApiTags('Campaigns')
@ApiBearerAuth('JWT-auth')
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly cancelAndReissueService: CancelAndReissueService,
  ) {}

  @Post()
  @Roles(AppRole.admin, AppRole.ngo)
  @UseGuards(OrgOwnershipGuard)
  @ApiOperation({ summary: 'Create a campaign' })
  @ApiBody({ type: CreateCampaignDto })
  @ApiCreatedResponse({ description: 'Campaign created successfully.' })
  @ApiBadRequestResponse({
    description: 'Invalid input parameters or malformed request body.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - insufficient permissions for this operation.',
  })
  async create(@Body() dto: CreateCampaignDto, @Req() req: Request) {
    const campaign = await this.campaigns.create(dto, req.user?.ngoId);
    return ApiResponseDto.ok(campaign, 'Campaigns created successfully');
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } }) // Limit to 10 requests per minute for this endpoint
  @Get()
  @ApiOperation({
    summary: 'List all campaigns',
    description:
      "Retrieves campaigns. NGO operators only see their own organization's campaigns.",
  })
  @ApiOkResponse({ description: 'List of campaigns retrieved successfully.' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  async list(
    @Query('includeArchived', new DefaultValuePipe(false), ParseBoolPipe)
    includeArchived: boolean,
    @Req() req: Request,
  ) {
    // Scope to ngoId for NGO role; admins/operators see all
    const ngoId = req.user?.role === AppRole.ngo ? req.user.ngoId : undefined;
    const campaigns = await this.campaigns.findAll(includeArchived, ngoId);
    return ApiResponseDto.ok(campaigns, 'Campaigns fetched successfully');
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get campaign details',
    description: 'Retrieves metadata and status for a specific campaign.',
  })
  @ApiOkResponse({ description: 'Campaign details retrieved successfully.' })
  @ApiNotFoundResponse({ description: 'The specified campaign was not found.' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  async get(@Param('id') id: string) {
    const campaign = await this.campaigns.findOne(id);
    return ApiResponseDto.ok(campaign, 'Campaign fetched successfully');
  }

  @Patch(':id')
  @UseGuards(OrgOwnershipGuard)
  @ApiOperation({
    summary: 'Update a campaign',
    description:
      'Modifies existing campaign properties. Only provided fields are updated.',
  })
  @ApiOkResponse({ description: 'Campaign updated successfully.' })
  @ApiNotFoundResponse({ description: 'The specified campaign was not found.' })
  @ApiBadRequestResponse({
    description: 'Invalid update data or malformed request body.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - insufficient permissions.',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    const updateData = await this.campaigns.update(id, dto);
    return ApiResponseDto.ok(updateData, 'Campaign updated successfully');
  }

  @Patch(':id/archive')
  @UseGuards(OrgOwnershipGuard)
  @ApiOperation({
    summary: 'Archive campaign (soft archive)',
    description:
      'Marks a campaign as archived. Archived campaigns are hidden from general listings.',
  })
  @ApiOkResponse({ description: 'Campaign archived successfully.' })
  @ApiNotFoundResponse({ description: 'The specified campaign was not found.' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - insufficient permissions.',
  })
  async archive(@Param('id') id: string) {
    const campaignData = await this.campaigns.archive(id);
    const { campaign, alreadyArchived } = campaignData;
    const msg = alreadyArchived
      ? 'Campaign already archived'
      : 'Campaign archived successfully';
    return ApiResponseDto.ok(campaign, msg);
  }

  @Get(':id/balance')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    summary: 'Get campaign balance summary',
    description:
      'Returns the current locked, disbursed, and available budget for a campaign. ' +
      'Locked balance accounts for all active (non-cancelled, non-disbursed) claims. ' +
      'Cancelled claims release their locked amount back to available.',
  })
  @ApiOkResponse({
    description: 'Campaign balance retrieved successfully.',
    schema: {
      properties: {
        campaignId: { type: 'string' },
        budget: { type: 'number', description: 'Total campaign budget.' },
        lockedAmount: {
          type: 'number',
          description: 'Amount locked by active claims.',
        },
        disbursedAmount: {
          type: 'number',
          description: 'Amount already disbursed.',
        },
        availableBudget: {
          type: 'number',
          description: 'Remaining available budget.',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Campaign not found.' })
  @ApiForbiddenResponse({
    description: 'Access denied - operator role required.',
  })
  async getBalance(@Param('id') id: string) {
    const balance = await this.cancelAndReissueService.getCampaignBalance(id);
    return ApiResponseDto.ok(balance, 'Campaign balance fetched successfully');
  }

  @Get('export')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    summary: 'Export campaigns as CSV',
    description:
      'Exports campaign summaries as CSV with support for date range, status, organization, and pagination filters. ' +
      'Excludes sensitive internal metadata and deleted records.',
  })
  @ApiOkResponse({
    description: 'Campaigns exported successfully.',
    content: {
      'text/csv': {
        schema: { type: 'string' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - operator or admin role required.',
  })
  @ApiQuery({ name: 'from', required: false, description: 'Start date (ISO string)' })
  @ApiQuery({ name: 'to', required: false, description: 'End date (ISO string)' })
  @ApiQuery({ name: 'status', required: false, description: 'Campaign status filter' })
  @ApiQuery({ name: 'orgId', required: false, description: 'Organization ID filter' })
  @ApiQuery({ name: 'ngoId', required: false, description: 'NGO ID filter' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (default: 50, max: 200)' })
  async exportCampaigns(
    @Query() query: ExportCampaignsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.campaigns.exportCampaigns(query);

    const csv = this.campaigns.buildCsv(result.data);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="campaigns-export-${Date.now()}.csv"`,
    );
    res.setHeader('X-Total-Count', String(result.total));
    res.setHeader('X-Page', String(result.page));
    res.setHeader('X-Limit', String(result.limit));

    return csv;
  }
}

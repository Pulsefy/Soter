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
  UseGuards,
} from '@nestjs/common';
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
} from '@nestjs/swagger';
import { Request } from 'express';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { Roles } from 'src/auth/roles.decorator';
import { AppRole } from 'src/auth/app-role.enum';
import { Throttle } from '@nestjs/throttler';
import { OrgOwnershipGuard } from '../common/guards/org-ownership.guard';

import { CsvUtil } from '../common/utils/csv.util';
import { ExportFiltersDto } from '../common/dto/export-filters.dto';
import { Response } from 'express';
import { Res } from '@nestjs/common';

@ApiTags('Campaigns')
@ApiBearerAuth('JWT-auth')
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get('export')
  @Roles(AppRole.admin, AppRole.ngo)
  @ApiOperation({ summary: 'Export campaigns to CSV' })
  @ApiOkResponse({ description: 'CSV file containing campaign data.' })
  async export(
    @Query() filters: ExportFiltersDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ngoId = req.user?.role === AppRole.ngo ? req.user.ngoId : filters.ngoId;
    const data = await this.campaigns.exportToCsv({ ...filters, ngoId });
    const csv = CsvUtil.generateCsv(data);

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="campaigns-export-${Date.now()}.csv"`,
    });

    return res.send(csv);
  }

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
}

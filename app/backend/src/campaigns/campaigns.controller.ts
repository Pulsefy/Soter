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
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { Roles } from 'src/auth/roles.decorator';
import { AppRole } from 'src/auth/app-role.enum';

@ApiTags('Campaigns')
@ApiBearerAuth('JWT-auth')
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post()
  @Roles(AppRole.admin, AppRole.ngo)
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
  async create(@Body() dto: CreateCampaignDto) {
    const campaign = await this.campaigns.create(dto);
    return ApiResponseDto.ok(campaign, 'Campaigns created successfully');
  }

  @Get()
  @ApiOkResponse({ description: 'List of campaigns retrieved successfully.' })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid authentication credentials.',
  })
  async list(
    @Query('includeArchived', new DefaultValuePipe(false), ParseBoolPipe)
    includeArchived: boolean,
  ) {
    const campaigns = await this.campaigns.findAll(includeArchived);
    return ApiResponseDto.ok(campaigns, 'Campaigns fetched successfully');
  }

  @Get(':id')
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
  @Patch(':id/archive')
  async archive(@Param('id') id: string) {
    const campaignData = await this.campaigns.archive(id);
    const { campaign, alreadyArchived } = campaignData;
    const msg = alreadyArchived
      ? 'Campaign already archived'
      : 'Campaign archived successfully';
    return ApiResponseDto.ok(campaign, msg);
  }
}

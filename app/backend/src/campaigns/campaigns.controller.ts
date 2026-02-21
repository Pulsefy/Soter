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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';

@ApiTags('Campaigns')
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a campaign' })
  @ApiBody({ type: CreateCampaignDto })
  @Roles('admin', 'ngo') // Only admin or ngo can create
  @UseGuards(RolesGuard)
  @ApiResponse({ status: 201, description: 'Campaign created' })
  async create(@Body() dto: CreateCampaignDto) {
    const campaign = await this.campaigns.create(dto);
    return ApiResponseDto.ok(campaign, 'Campaigns created successfully');
  }

  @Get()
  @ApiOperation({ summary: 'List campaigns' })
  @ApiQuery({
    name: 'includeArchived',
    required: false,
    type: Boolean,
    description: 'Include archived campaigns',
  })
  async list(
    @Query('includeArchived', new DefaultValuePipe(false), ParseBoolPipe)
    includeArchived: boolean,
  ) {
    const campaigns = await this.campaigns.findAll(includeArchived);
    return ApiResponseDto.ok(campaigns, 'Campaigns fetched successfully');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get campaign by id' })
  @ApiParam({ name: 'id', description: 'Campaign id (cuid)' })
  async get(@Param('id') id: string) {
    const campaign = await this.campaigns.findOne(id);
    return ApiResponseDto.ok(campaign, 'Campaign fetched successfully');
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update campaign' })
  @ApiBody({ type: UpdateCampaignDto })
  async update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    const updateData = await this.campaigns.update(id, dto);
    return ApiResponseDto.ok(updateData, 'Campaign updated successfully');
  }

  @Patch(':id/archive')
  @ApiOperation({ summary: 'Archive campaign (soft archive)' })
  @ApiParam({ name: 'id', description: 'Campaign id (cuid)' })
  async archive(@Param('id') id: string) {
    const campaignData = await this.campaigns.archive(id);
    const { campaign, alreadyArchived } = campaignData;
    const msg = alreadyArchived
      ? 'Campaign already archived'
      : 'Campaign archived successfully';
    return ApiResponseDto.ok(campaign, msg);
  }
}

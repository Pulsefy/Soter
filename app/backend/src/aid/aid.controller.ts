import {
  Controller,
  Body,
  Param,
  Post,
  Patch,
  Delete,
  Put,
  Get,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AidService } from './aid.service';
import { ListAidPackagesDto } from './dto/list-aid-packages.dto';
import { ListRecipientPackagesDto } from './dto/list-recipient-packages.dto';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiBearerAuth,
} from '@nestjs/swgger';

@ApiTags('Aid')
@ApiBearerAuth('JWT-auth')
@Controller('aid')
export class AidController {
  constructor(private readonly aidService: AidService) {}

  @Get('packages')
  @ApiOperation({
    summary: 'List aid packages with pagination',
    description:
      'Returns a paginated list of aid packages. Supports filtering by status, search text, and sorting.',
  })
  @ApiOkResponse({ description: 'Paginated list of aid packages.' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.' })
  async listPackages(@Query() query: ListAidPackagesDto) {
    return this.aidService.listAidPackages(query);
  }

  @Get('recipients/:recipient/packages')
  @ApiOperation({
    summary: 'List aid packages for a recipient',
    description:
      'Returns a paginated list of aid packages held by the given recipient, read from onchain truth.',
  })
  @ApiOkResponse({ description: 'Paginated list of recipient aid packages.' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.' })
  async listRecipientPackages(
    @Param('recipient') recipient: string,
    @Query() query: ListRecipientPackagesDto,
  ) {
    return this.aidService.listRecipientPackages(recipient, query);
  }

  @Get('recipients/:recipient/packages/count')
  @ApiOperation({
    summary: 'Count aid packages for a recipient',
    description:
      'Returns the total number of aid packages held by the given recipient, read from onchain truth.',
  })
  @ApiOkResponse({ description: 'Recipient aid package count.' })
  @ApiBadRequestResponse({ description: 'Invalid recipient address.' })
  async getRecipientPackageCount(@Param('recipient') recipient: string) {
    return this.aidService.getRecipientPackageCount(recipient);
  }

  @Post('campaigns')
  @ApiOperation({
    summary: 'Create a new campaign',
    description:
      'Initializes a new aid campaign with provided metadata. Requires appropriate permissions.',
  })
  @ApiCreatedResponse({ description: 'Campaign created successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid input parameters.' })
  async createCampaign(
    @Body() data: Record<string, unknown>,
    @Req() req: Request,
  ) {
    return this.aidService.createCampaign(data, req.user);
  }

  @Patch('campaigns:/id')
  @ApiOperation({
    summary: 'Update a campaign',
    description:
      'Modifies an existing campaign. Only provided fields will be updated.',
  })
  @ApiOkResponse({ description: 'Campaign updated successfully.' })
  @ApiNotFoundResponse({ description: 'The specified campaign was not found.' })
  @ApiBadRequestResponse({ description: 'Invalid update data.' })
  async updateCampaign(
    @Param('id') id: string,
    @Body() data: Record<string, unknown>,
  ) {
    return this.aidService.updateCampaign(id, data);
  }

  @Delete('campaigns/:id')
  @ApiOperation({
    summary: 'Archive a campaign',
    description:
      'Soft-archives a campaign, making it invisible to standard listings.',
  })
  @ApiOkResponse({ description: 'Campaign archived successfully.' })
  @ApiNotFoundResponse({ description: 'The specified campaign was not found.' })
  async archiveCampaign(@Param('id') id: string) {
    return this.aidService.archiveCampaign(id);
  }

  @Put('claims/:id/status')
  @ApiOperation({
    summary: 'Transition a claim status',
    description:
      'Moves a claim from one status to another (e.g., pending -> approved).',
  })
  @ApiOkResponse({ description: 'Claim status transitioned successfully.' })
  @ApiBadRequestResponse({
    description: 'Invalid status transition requested.',
  })
  @ApiNotFoundResponse({ description: 'The specified claim was not found.' })
  async transitionClaim(
    @Param('id') id: string,
    @Body('from') from: string,
    @Body('to') to: string,
  ) {
    return this.aidService.transitionClaim(id, from, to);
  }
}

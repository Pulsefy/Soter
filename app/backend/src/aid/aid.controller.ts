import {
  Controller,
  Body,
  Param,
  Post,
  Patch,
  Delete,
  Put,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AidService } from './aid.service';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('Aid')
@ApiBearerAuth('JWT-auth')
@Controller('aid')
export class AidController {
  constructor(private readonly aidService: AidService) {}

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

  @Patch('campaigns/:id')
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

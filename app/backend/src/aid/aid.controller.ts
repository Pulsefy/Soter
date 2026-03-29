import {
  Controller,
  Body,
  Param,
  Post,
} from '@nestjs/common';
import { AidService } from './aid.service';
import { AiTaskWebhookDto } from './dto/ai-task-webhook.dto';
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

  @ApiOperation({
    summary: 'Create a new campaign',
    description:
      'Initializes a new aid campaign with provided metadata. Requires appropriate permissions.',
  })
  @ApiCreatedResponse({ description: 'Campaign created successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid input parameters.' })
  async createCampaign(@Body() data: Record<string, unknown>) {
    return this.aidService.createCampaign(data);
  }

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

  @ApiOperation({
    summary: 'Webhook for AI task notifications',
    description:
      'Receives notifications from the AI service when background tasks complete.',
  })
  @ApiOkResponse({ description: 'Webhook received successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid webhook payload.' })
  @Post('webhook')
  async handleTaskWebhook(@Body() payload: AiTaskWebhookDto) {
    return this.aidService.handleTaskWebhook(payload);
  }
}

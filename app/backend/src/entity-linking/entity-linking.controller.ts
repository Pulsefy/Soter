import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { EntityLinkingService } from './entity-linking.service';
import {
  CreateEntityLinkDto,
  EntityLinkQueryDto,
  EntityLinkReviewQueueQueryDto,
  ReviewEntityLinkDto,
} from './dto/entity-link.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';

interface ReviewerUser {
  sub?: string;
  apiKeyId?: string;
}

@Controller('entity-linking')
@ApiTags('Entity Linking')
@ApiBearerAuth('JWT-auth')
@UseGuards(ApiKeyGuard, RolesGuard)
@Roles(AppRole.admin, AppRole.operator)
export class EntityLinkingController {
  private readonly logger = new Logger(EntityLinkingController.name);

  constructor(private readonly entityLinkingService: EntityLinkingService) {}

  @Post('link')
  @ApiOperation({
    summary: 'Link extracted entity to canonical registry',
    description:
      'Create a link between an extracted entity and a canonical registry record with confidence scoring',
  })
  async linkEntity(@Body() dto: CreateEntityLinkDto) {
    this.logger.log(`Creating entity link for ${dto.extractedName}`);
    return this.entityLinkingService.linkEntity(dto);
  }

  @Get('links')
  @ApiOperation({
    summary: 'Query entity links',
    description: 'Search and filter entity links by various criteria',
  })
  @ApiQuery({
    name: 'sourceType',
    required: false,
    enum: ['campaign', 'claim', 'verification'],
  })
  @ApiQuery({ name: 'sourceId', required: false })
  @ApiQuery({
    name: 'entityType',
    required: false,
    enum: ['organization', 'location', 'asset', 'project'],
  })
  @ApiQuery({ name: 'minConfidence', required: false, type: Number })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({
    name: 'reviewStatus',
    required: false,
    enum: [
      'auto_accepted',
      'pending_review',
      'accepted',
      'rejected',
      'remapped',
    ],
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async queryLinks(@Query() query: EntityLinkQueryDto) {
    return this.entityLinkingService.queryLinks(query);
  }

  @Get('campaign/:campaignId')
  @ApiOperation({
    summary: 'Get entity links by campaign',
    description:
      'Retrieve all entity links associated with a specific campaign',
  })
  @ApiParam({ name: 'campaignId', description: 'Campaign ID' })
  @ApiQuery({
    name: 'entityType',
    required: false,
    enum: ['organization', 'location', 'asset', 'project'],
  })
  async getLinksByCampaign(
    @Param('campaignId') campaignId: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.entityLinkingService.getLinksByCampaign(campaignId, entityType);
  }

  @Get('claim/:claimId')
  @ApiOperation({
    summary: 'Get entity links by claim',
    description: 'Retrieve all entity links associated with a specific claim',
  })
  @ApiParam({ name: 'claimId', description: 'Claim ID' })
  @ApiQuery({
    name: 'entityType',
    required: false,
    enum: ['organization', 'location', 'asset', 'project'],
  })
  async getLinksByClaim(
    @Param('claimId') claimId: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.entityLinkingService.getLinksByClaim(claimId, entityType);
  }

  @Get('verification/:verificationId')
  @ApiOperation({
    summary: 'Get entity links by verification',
    description:
      'Retrieve all entity links associated with a specific verification',
  })
  @ApiParam({ name: 'verificationId', description: 'Verification ID' })
  @ApiQuery({
    name: 'entityType',
    required: false,
    enum: ['organization', 'location', 'asset', 'project'],
  })
  async getLinksByVerification(
    @Param('verificationId') verificationId: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.entityLinkingService.getLinksByVerification(
      verificationId,
      entityType,
    );
  }

  @Get('review-queue')
  @ApiOperation({
    summary: 'List entity links awaiting review',
    description:
      'Returns links whose confidence score fell below the auto-accept threshold, oldest-queued first',
  })
  @ApiQuery({
    name: 'entityType',
    required: false,
    enum: ['organization', 'location', 'asset', 'project'],
  })
  @ApiQuery({
    name: 'sourceType',
    required: false,
    enum: ['campaign', 'claim', 'verification'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getReviewQueue(@Query() query: EntityLinkReviewQueueQueryDto) {
    return this.entityLinkingService.getReviewQueue(query);
  }

  @Patch('review/:linkId')
  @ApiOperation({
    summary: 'Decide a queued (or previously decided) entity link',
    description:
      'Reviewer accepts, rejects, or remaps a link. Only links currently pending review can be decided.',
  })
  @ApiParam({ name: 'linkId', description: 'Entity Link ID' })
  async decideReview(
    @Param('linkId') linkId: string,
    @Body() dto: ReviewEntityLinkDto,
    @Request() req: ExpressRequest,
  ) {
    const user = req.user as ReviewerUser | undefined;
    const reviewerId: string = user?.sub ?? user?.apiKeyId ?? 'system';

    this.logger.log(
      `Reviewer ${reviewerId} decided "${dto.action}" on entity link ${linkId}`,
    );
    return this.entityLinkingService.decideReview(linkId, dto, reviewerId);
  }

  @Get('registry/search')
  @ApiOperation({
    summary: 'Search canonical registry',
    description: 'Search for potential matches in the canonical registry',
  })
  @ApiQuery({
    name: 'entityType',
    enum: ['organization', 'location', 'asset', 'project'],
  })
  @ApiQuery({ name: 'query', description: 'Search query' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async searchRegistry(
    @Query('entityType')
    entityType: 'organization' | 'location' | 'asset' | 'project',
    @Query('query') query: string,
    @Query('limit') limit?: number,
  ) {
    return this.entityLinkingService.searchRegistry(
      entityType,
      query,
      limit ? parseInt(String(limit)) : 10,
    );
  }
}

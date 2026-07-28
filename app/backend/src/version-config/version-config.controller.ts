import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Logger,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiInternalServerErrorResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { VersionConfigService } from './version-config.service';
import {
  CreateVersionConfigDto,
  UpdateVersionConfigDto,
  VersionConfigResponseDto,
  PublicVersionConfigResponseDto,
} from './dto/version-config.dto';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import { Public } from '../common/decorators/public.decorator';

/**
 * VersionConfigController
 * REST API endpoints for managing and querying version configuration and release notes.
 * Public endpoint serves version info to clients, admin endpoints manage configuration.
 */
@ApiTags('Version Config')
@ApiBearerAuth('JWT-auth')
@Controller('version-config')
export class VersionConfigController {
  private readonly logger = new Logger(VersionConfigController.name);

  constructor(private readonly versionConfigService: VersionConfigService) {}

  /**
   * Get public version config by platform
   * GET /config/version?platform=web
   * @public - accessible to all clients
   */
  @Public()
  @Get('public')
  @ApiOperation({
    summary: 'Get platform-specific release configuration (public)',
    description:
      'Returns version info, release notes, and force-upgrade requirements for the given platform. This endpoint is public and accessible to all clients.',
  })
  @ApiOkResponse({
    description: 'Version config retrieved successfully.',
    type: PublicVersionConfigResponseDto,
  })
  async getPublicConfig(
    @Query('platform') platform = 'web',
  ): Promise<PublicVersionConfigResponseDto> {
    this.logger.log(`Fetching public version config for platform: ${platform}`);
    return this.versionConfigService.findPublicByPlatform(platform);
  }

  /**
   * Create a new version config record
   * POST /version-config
   * @protected admin only
   */
  @Post()
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create version config (admin only)',
    description: 'Creates a new version configuration record for a platform.',
  })
  @ApiCreatedResponse({
    description: 'Version config created successfully.',
    type: VersionConfigResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid input parameters.' })
  @ApiInternalServerErrorResponse({
    description: 'Failed to create version config.',
  })
  async create(
    @Body() dto: CreateVersionConfigDto,
  ): Promise<VersionConfigResponseDto> {
    this.logger.log(`Creating version config for platform: ${dto.platform}`);
    try {
      return await this.versionConfigService.create(dto);
    } catch (error: unknown) {
      this.logger.error('Failed to create version config:', error);
      if ((error as { code?: string }).code === 'P2002') {
        throw new BadRequestException(
          `Version config already exists for platform: ${dto.platform}`,
        );
      }
      throw error;
    }
  }

  /**
   * Get all version configs
   * GET /version-config
   * @protected admin only
   */
  @Get()
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'List all version configs (admin only)',
    description:
      'Returns all version configuration records, ordered by platform.',
  })
  @ApiOkResponse({
    description: 'Version config records.',
    type: [VersionConfigResponseDto],
  })
  async findAll(): Promise<VersionConfigResponseDto[]> {
    this.logger.log('Fetching all version configs');
    return this.versionConfigService.findAll();
  }

  /**
   * Get version config by platform
   * GET /version-config/:platform
   * @protected admin only
   */
  @Get(':platform')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Get version config by platform (admin only)',
    description: 'Returns the version configuration for a specific platform.',
  })
  @ApiOkResponse({
    description: 'Version config for the specified platform.',
    type: VersionConfigResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Version config not found.' })
  async findByPlatform(
    @Param('platform') platform: string,
  ): Promise<VersionConfigResponseDto | { message: string }> {
    this.logger.log(`Fetching version config for platform: ${platform}`);
    const config = await this.versionConfigService.findByPlatform(platform);

    if (!config) {
      return {
        message: `No version config found for platform: ${platform}`,
      };
    }

    return config;
  }

  /**
   * Update version config
   * PUT /version-config/:id
   * @protected admin only
   */
  @Put(':id')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update version config (admin only)',
    description: 'Updates an existing version configuration record.',
  })
  @ApiOkResponse({
    description: 'Version config updated successfully.',
    type: VersionConfigResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid input parameters.' })
  @ApiNotFoundResponse({ description: 'Version config not found.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVersionConfigDto,
  ): Promise<VersionConfigResponseDto> {
    this.logger.log(`Updating version config ${id}`);
    return this.versionConfigService.update(id, dto);
  }

  /**
   * Delete version config
   * DELETE /version-config/:id
   * @protected admin only
   */
  @Delete(':id')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete version config (admin only)',
    description: 'Deletes a version configuration record.',
  })
  @ApiNotFoundResponse({ description: 'Version config not found.' })
  async delete(@Param('id') id: string): Promise<void> {
    this.logger.log(`Deleting version config ${id}`);
    await this.versionConfigService.delete(id);
  }
}

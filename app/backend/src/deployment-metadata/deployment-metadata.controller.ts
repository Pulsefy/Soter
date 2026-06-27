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
import { DeploymentMetadataService } from './deployment-metadata.service';
import {
  CreateDeploymentMetadataDto,
  UpdateDeploymentMetadataDto,
  DeploymentMetadataResponseDto,
} from './dto/deployment-metadata.dto';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';

/**
 * DeploymentMetadataController
 * REST API endpoints for managing and querying contract deployment metadata.
 * This is an internal/admin API for visibility into deployed contracts and their provenance.
 */
@ApiTags('Deployment Metadata')
@ApiBearerAuth('JWT-auth')
@Controller('deployment-metadata')
export class DeploymentMetadataController {
  private readonly logger = new Logger(DeploymentMetadataController.name);

  constructor(
    private readonly deploymentMetadataService: DeploymentMetadataService,
  ) {}

  /**
   * Create a new deployment metadata record
   * POST /deployment-metadata
   * @protected admin only
   */
  @Post()
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create deployment metadata (admin only)',
    description:
      'Creates a new contract deployment metadata record. Used to record contract deployments with their network, address, and provenance.',
  })
  @ApiCreatedResponse({
    description: 'Deployment metadata created successfully.',
    type: DeploymentMetadataResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid input parameters.' })
  @ApiInternalServerErrorResponse({
    description: 'Failed to create deployment metadata.',
  })
  async create(
    @Body() dto: CreateDeploymentMetadataDto,
  ): Promise<DeploymentMetadataResponseDto> {
    this.logger.log(
      `Creating deployment metadata: ${dto.network}/${dto.contractName}`,
    );
    try {
      return await this.deploymentMetadataService.create(dto);
    } catch (error) {
      this.logger.error('Failed to create deployment metadata:', error);
      if (error.code === 'P2002') {
        throw new BadRequestException(
          `Deployment metadata already exists for ${dto.network}/${dto.contractName}`,
        );
      }
      throw error;
    }
  }

  /**
   * Get all deployment metadata
   * GET /deployment-metadata
   * @protected admin only (for internal visibility)
   */
  @Get()
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'List all deployment metadata (admin only)',
    description:
      'Returns all contract deployment metadata records, ordered by deployment date (newest first).',
  })
  @ApiOkResponse({
    description: 'Deployment metadata records.',
    type: [DeploymentMetadataResponseDto],
  })
  async findAll(): Promise<DeploymentMetadataResponseDto[]> {
    this.logger.log('Fetching all deployment metadata');
    return this.deploymentMetadataService.findAll();
  }

  /**
   * Get deployment metadata by network
   * GET /deployment-metadata/by-network/:network
   * @protected admin only
   */
  @Get('by-network/:network')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Get deployment metadata by network (admin only)',
    description:
      'Returns all contract deployments for a specific network (e.g., testnet, mainnet).',
  })
  @ApiOkResponse({
    description: 'Deployment metadata for the specified network.',
    type: [DeploymentMetadataResponseDto],
  })
  @ApiNotFoundResponse({
    description: 'No deployments found for this network.',
  })
  async findByNetwork(
    @Param('network') network: string,
  ): Promise<DeploymentMetadataResponseDto[]> {
    this.logger.log(`Fetching deployment metadata for network: ${network}`);
    return this.deploymentMetadataService.findByNetwork(network);
  }

  /**
   * Get deployment metadata by network and contract name
   * GET /deployment-metadata/by-contract/:network/:contractName
   * @protected admin only
   */
  @Get('by-contract/:network/:contractName')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary:
      'Get deployment metadata by network and contract name (admin only)',
    description:
      'Returns the latest deployment metadata for a specific contract on a specific network.',
  })
  @ApiOkResponse({
    description: 'Deployment metadata for the specified contract.',
    type: DeploymentMetadataResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Deployment metadata not found.' })
  async findByNetworkAndContractName(
    @Param('network') network: string,
    @Param('contractName') contractName: string,
  ): Promise<DeploymentMetadataResponseDto | { message: string }> {
    this.logger.log(
      `Fetching deployment metadata for ${network}/${contractName}`,
    );
    const metadata =
      await this.deploymentMetadataService.findByNetworkAndContractName(
        network,
        contractName,
      );

    if (!metadata) {
      return {
        message: `No deployment metadata found for ${network}/${contractName}`,
      };
    }

    return metadata;
  }

  /**
   * Get deployment metadata by contract ID
   * GET /deployment-metadata/by-contract-id/:contractId
   * @protected admin only
   */
  @Get('by-contract-id/:contractId')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Get deployment metadata by contract ID (admin only)',
    description:
      'Returns deployment metadata for a specific contract ID (address).',
  })
  @ApiOkResponse({
    description: 'Deployment metadata for the specified contract ID.',
    type: DeploymentMetadataResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Deployment metadata not found.' })
  async findByContractId(
    @Param('contractId') contractId: string,
  ): Promise<DeploymentMetadataResponseDto | { message: string }> {
    this.logger.log(
      `Fetching deployment metadata for contract ID: ${contractId}`,
    );
    const metadata =
      await this.deploymentMetadataService.findByContractId(contractId);

    if (!metadata) {
      return {
        message: `No deployment metadata found for contract ID ${contractId}`,
      };
    }

    return metadata;
  }

  /**
   * Update deployment metadata
   * PUT /deployment-metadata/:id
   * @protected admin only
   */
  @Put(':id')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update deployment metadata (admin only)',
    description: 'Updates an existing deployment metadata record.',
  })
  @ApiOkResponse({
    description: 'Deployment metadata updated successfully.',
    type: DeploymentMetadataResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid input parameters.' })
  @ApiNotFoundResponse({ description: 'Deployment metadata not found.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDeploymentMetadataDto,
  ): Promise<DeploymentMetadataResponseDto> {
    this.logger.log(`Updating deployment metadata ${id}`);
    return this.deploymentMetadataService.update(id, dto);
  }

  /**
   * Delete deployment metadata
   * DELETE /deployment-metadata/:id
   * @protected admin only
   */
  @Delete(':id')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete deployment metadata (admin only)',
    description: 'Deletes a deployment metadata record.',
  })
  @ApiNotFoundResponse({ description: 'Deployment metadata not found.' })
  async delete(@Param('id') id: string): Promise<void> {
    this.logger.log(`Deleting deployment metadata ${id}`);
    await this.deploymentMetadataService.delete(id);
  }
}

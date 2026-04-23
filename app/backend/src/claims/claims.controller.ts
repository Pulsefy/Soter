import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Query,
  Req,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { ClaimsService } from './claims.service';
import { ArtifactService } from './artifact.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { Roles } from 'src/auth/roles.decorator';
import { AppRole } from 'src/auth/app-role.enum';

@ApiTags('Onchain Proxy')
@ApiBearerAuth('JWT-auth')
@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly artifactService: ArtifactService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a claim',
    description: 'Initializes a new claim for a specific campaign.',
  })
  @ApiCreatedResponse({
    description: 'Claim created successfully.',
    type: CreateClaimDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input parameters.',
  })
  @ApiNotFoundResponse({
    description: 'The specified campaign was not found.',
  })
  create(@Body() createClaimDto: CreateClaimDto) {
    return this.claimsService.create(createClaimDto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all claims',
    description: 'Retrieves a list of all claims across all campaigns.',
  })
  @ApiOkResponse({
    description: 'List of all claims retrieved successfully.',
  })
  findAll() {
    return this.claimsService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get claim details',
    description:
      'Retrieves the current details and status of a specific claim.',
  })
  @ApiOkResponse({
    description: 'Claim details retrieved successfully.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  findOne(@Param('id') id: string) {
    return this.claimsService.findOne(id);
  }

  @Post(':id/verify')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    summary: 'Verify a claim',
    description: 'Marks a claim as verified. Requires operator or admin role.',
  })
  @ApiOkResponse({
    description: 'Claim status transitioned to verified successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - insufficient permissions.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  verify(@Param('id') id: string) {
    return this.claimsService.verify(id);
  }

  @Post(':id/approve')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Approve a claim',
    description: 'Approves a verified claim. Requires admin role.',
  })
  @ApiOkResponse({
    description: 'Claim approved successfully (verified → approved).',
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  approve(@Param('id') id: string) {
    return this.claimsService.approve(id);
  }

  @Post(':id/disburse')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Disburse funds for a claim',
    description:
      'Initiates on-chain disbursement for an approved claim. Requires admin role.',
  })
  @ApiOkResponse({
    description: 'On-chain disbursement initiated or completed successfully.',
    content: {
      'application/json': {
        examples: {
          success: {
            summary: 'Successful on-chain disbursement',
            value: {
              id: 'claim_123',
              status: 'disbursed',
              transactionHash: '0x123...abc',
              amount: '100.50',
            },
          },
          pending: {
            summary: 'Disbursement pending on-chain',
            value: {
              id: 'claim_123',
              status: 'disbursing',
              message: 'Check back for final transaction hash.',
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition or account state.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  disburse(@Param('id') id: string) {
    return this.claimsService.disburse(id);
  }

  @Patch(':id/archive')
  @ApiOperation({
    summary: 'Archive a claim',
    description: 'Soft-archives a claim, hiding it from general listings.',
  })
  @ApiOkResponse({
    description: 'Claim archived successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  archive(@Param('id') id: string) {
    return this.claimsService.archive(id);
  }

  @Get(':id/artifact-url')
  @Roles(AppRole.admin, AppRole.operator, AppRole.ngo)
  @ApiOperation({ summary: 'Get a short-lived signed URL for a claim artifact' })
  @ApiParam({ name: 'id', description: 'Claim ID' })
  @ApiResponse({ status: 200, description: 'Signed URL issued' })
  @ApiResponse({ status: 403, description: 'Insufficient role or wrong org' })
  @ApiResponse({ status: 404, description: 'Claim or artifact not found' })
  async getArtifactUrl(@Param('id') id: string, @Req() req: Request) {
    const actor = req.user!;
    return this.artifactService.issueSignedUrl(
      id,
      actor.id ?? actor.role,
      actor.role as AppRole,
      actor.orgId,
    );
  }

  @Get(':id/artifact')
  @ApiOperation({ summary: 'Download artifact via signed token (proxy)' })
  @ApiParam({ name: 'id', description: 'Claim ID' })
  @ApiQuery({ name: 'token', description: 'Short-lived signed token' })
  @ApiResponse({ status: 200, description: 'Artifact file stream' })
  @ApiResponse({ status: 401, description: 'Token expired or invalid' })
  @ApiResponse({ status: 403, description: 'Token/claim mismatch' })
  @ApiResponse({ status: 404, description: 'Artifact not found' })
  async downloadArtifact(
    @Param('id') id: string,
    @Query('token') token: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const actorId = req.user?.id ?? req.user?.role ?? 'anonymous';
    const evidenceRef = await this.artifactService.redeemToken(id, token, actorId);

    // evidenceRef is a local filesystem path; adapt for S3/GCS as needed.
    if (!existsSync(evidenceRef)) {
      return res.status(HttpStatus.NOT_FOUND).json({ message: 'Artifact file not found' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="evidence-${id}"`);
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(evidenceRef).pipe(res);
  }
}

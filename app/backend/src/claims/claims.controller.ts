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

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly artifactService: ArtifactService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new claim' })
  @ApiResponse({ status: 201, description: 'Claim created successfully' })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  create(@Body() createClaimDto: CreateClaimDto) {
    return this.claimsService.create(createClaimDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all claims' })
  @ApiResponse({ status: 200, description: 'List of claims' })
  findAll() {
    return this.claimsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a claim by ID' })
  @ApiParam({ name: 'id', description: 'Claim ID' })
  @ApiResponse({ status: 200, description: 'Claim details' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  findOne(@Param('id') id: string) {
    return this.claimsService.findOne(id);
  }

  @Post(':id/verify')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({ summary: 'Verify a claim (requested → verified)' })
  @ApiParam({ name: 'id', description: 'Claim ID' })
  @ApiResponse({ status: 200, description: 'Claim verified' })
  @ApiResponse({ status: 400, description: 'Invalid transition' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  verify(@Param('id') id: string) {
    return this.claimsService.verify(id);
  }

  @Post(':id/approve')
  @Roles(AppRole.admin)
  @ApiOperation({ summary: 'Approve a claim (verified → approved)' })
  @ApiParam({ name: 'id', description: 'Claim ID' })
  @ApiResponse({ status: 200, description: 'Claim approved' })
  @ApiResponse({ status: 400, description: 'Invalid transition' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  approve(@Param('id') id: string) {
    return this.claimsService.approve(id);
  }

  @Post(':id/disburse')
  @Roles(AppRole.admin)
  @ApiOperation({ summary: 'Disburse a claim (approved → disbursed)' })
  @ApiParam({ name: 'id', description: 'Claim ID' })
  @ApiResponse({ status: 200, description: 'Claim disbursed' })
  @ApiResponse({ status: 400, description: 'Invalid transition' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  disburse(@Param('id') id: string) {
    return this.claimsService.disburse(id);
  }

  @Patch(':id/archive')
  @ApiOperation({ summary: 'Archive a claim (disbursed → archived)' })
  @ApiParam({ name: 'id', description: 'Claim ID' })
  @ApiResponse({ status: 200, description: 'Claim archived' })
  @ApiResponse({ status: 400, description: 'Invalid transition' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
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

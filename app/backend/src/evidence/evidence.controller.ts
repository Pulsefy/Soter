import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { EvidenceService } from './evidence.service';
import { ArtifactOwnershipTokenService } from './artifact-ownership-token.service';
import { ArtifactTokenGuard, RequireArtifactToken } from '../common/guards/artifact-token.guard';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  UPLOAD_FIELD,
  evidenceMulterOptions,
  validateUploadedFile,
} from './file-validation';

@ApiTags('Evidence Queue')
@ApiBearerAuth('JWT-auth')
@Controller('evidence')
export class EvidenceController {
  constructor(
    private readonly evidenceService: EvidenceService,
    private readonly artifactTokenService: ArtifactOwnershipTokenService,
  ) {}

  @Post('upload')
  @Roles(AppRole.operator, AppRole.admin)
  // AnyFilesInterceptor lets us detect ambiguous inputs (zero or multiple
  // files) explicitly and reject them with a clear 400, instead of letting
  // Multer surface an opaque error. The fileFilter enforces the MIME/extension
  // allow-list at the streaming stage.
  @UseInterceptors(AnyFilesInterceptor(evidenceMulterOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload evidence to queue',
    description:
      'Encrypts and stores a single evidence file locally for eventual upload. ' +
      `Accepts one file (max ${MAX_FILE_SIZE / (1024 * 1024)}MB) in the "${UPLOAD_FIELD}" field. ` +
      `Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}.`,
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: [UPLOAD_FIELD],
      properties: {
        [UPLOAD_FIELD]: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Evidence queued successfully.' })
  upload(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Request() req: ExpressRequest,
  ) {
    const file = this.extractSingleFile(files);

    // Deep, content-aware validation: size, empty file, safe filename,
    // extension/MIME allow-list, extension/MIME consistency, and magic bytes.
    validateUploadedFile(file);

    const ownerId = req.user?.apiKeyId || req.user?.authType || 'system';
    return this.evidenceService.queueEvidence(file, ownerId);
  }

  /**
   * Rejects ambiguous multipart inputs and returns the single expected file.
   * Multer collects every uploaded part; we require exactly one and that it
   * was sent under the expected field name.
   */
  private extractSingleFile(
    files: Express.Multer.File[] | undefined,
  ): Express.Multer.File {
    if (!files || files.length === 0) {
      throw new BadRequestException('No file uploaded');
    }
    if (files.length > 1) {
      throw new BadRequestException(
        `Only a single file may be uploaded in the "${UPLOAD_FIELD}" field`,
      );
    }
    const file = files[0];
    if (file.fieldname !== UPLOAD_FIELD) {
      throw new BadRequestException(
        `Unexpected field "${file.fieldname}"; file must be sent in the "${UPLOAD_FIELD}" field`,
      );
    }
    return file;
  }

  @Get('queue')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    summary: 'List evidence queue',
    description:
      'Retrieves all evidence items in the queue for the current user.',
  })
  @ApiOkResponse({ description: 'Queue retrieved successfully.' })
  getQueue(@Request() req: ExpressRequest) {
    const ownerId = req.user?.apiKeyId || req.user?.authType || 'system';
    return this.evidenceService.findQueue(ownerId);
  }

  @Post('queue/:id/retry')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry evidence upload',
    description: 'Manually triggers a retry for a failed evidence upload.',
  })
  @ApiOkResponse({ description: 'Retry initiated.' })
  retry(@Param('id') id: string, @Request() req: ExpressRequest) {
    const ownerId = req.user?.apiKeyId || req.user?.authType || 'system';
    return this.evidenceService.retry(id, ownerId);
  }

  @Delete('queue/:id')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    summary: 'Remove from queue',
    description:
      'Removes an evidence item from the queue and deletes the local file.',
  })
  @ApiOkResponse({ description: 'Item removed successfully.' })
  remove(@Param('id') id: string, @Request() req: ExpressRequest) {
    const ownerId = req.user?.apiKeyId || req.user?.authType || 'system';
    return this.evidenceService.remove(id, ownerId);
  }

  @Post(':id/token')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generate artifact ownership token',
    description:
      'Creates a signed ownership token for an artifact. ' +
      'This token is required for backend-initiated access to evidence artifacts.',
  })
  @ApiCreatedResponse({
    description: 'Artifact ownership token created successfully.',
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Signed ownership token' },
        expiresAt: { type: 'string', format: 'date-time' },
        artifactId: { type: 'string' },
        orgId: { type: 'string' },
      },
    },
  })
  async generateArtifactToken(
    @Param('id') id: string,
    @Body('orgId') orgId: string,
    @Body('ttlSeconds') ttlSeconds?: number,
    @Request() req?: ExpressRequest,
  ) {
    if (!orgId) {
      throw new BadRequestException('orgId is required');
    }

    const userId = req?.user?.apiKeyId || req?.user?.authType || 'system';
    const role = req?.user?.role || 'operator';

    // Validate artifact ownership
    const ownsArtifact =
      await this.artifactTokenService.validateArtifactOwnership(id, orgId);
    if (!ownsArtifact) {
      throw new UnauthorizedException(
        'Artifact does not belong to the specified organization',
      );
    }

    const token = await this.artifactTokenService.createToken({
      artifactId: id,
      orgId,
      userId,
      role,
      ttlSeconds,
    });

    // Get expiration time from token
    const payload = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString('utf-8'),
    );

    return {
      token,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      artifactId: id,
      orgId,
    };
  }

  @Post(':id/access')
  @RequireArtifactToken()
  @UseGuards(ArtifactTokenGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('artifact-token')
  @ApiOperation({
    summary: 'Access artifact with ownership token',
    description:
      'Provides access to an artifact using a valid ownership token. ' +
      'The token must be provided via Authorization header or query parameter.',
  })
  @ApiOkResponse({
    description: 'Artifact access granted.',
    schema: {
      type: 'object',
      properties: {
        artifactId: { type: 'string' },
        filePath: { type: 'string' },
        metadata: { type: 'object' },
      },
    },
  })
  async accessArtifact(@Param('id') id: string, @Request() req: ExpressRequest) {
    const tokenPayload = req['artifactToken'];

    // Additional validation: ensure token artifact ID matches URL
    if (tokenPayload.artifactId !== id) {
      throw new UnauthorizedException('Token artifact ID mismatch');
    }

    // Get artifact details from evidence service
    const artifact = await this.evidenceService.findQueue(tokenPayload.userId);
    const artifactItem = artifact.find((item) => item.id === id);

    if (!artifactItem) {
      throw new UnauthorizedException('Artifact not found');
    }

    return {
      artifactId: artifactItem.id,
      filePath: artifactItem.filePath,
      metadata: artifactItem.metadata,
      accessedAt: new Date().toISOString(),
      accessedBy: tokenPayload.userId,
    };
  }
}

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request as ExpressRequest } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { Roles } from '../../auth/roles.decorator';
import { AppRole } from '../../auth/app-role.enum';
import { ResumableUploadService } from './resumable-upload.service';
import {
  CreateResumableUploadDto,
  UploadChunkDto,
  FinalizeUploadDto,
  ResumeUploadDto,
} from './dto';
import { evidenceMulterOptions } from '../file-validation';

function resolveOwner(req: ExpressRequest): string {
  const user = req.user;
  if (user?.apiKeyId) return user.apiKeyId;
  if (user?.sub) return user.sub;
  return 'system';
}

function resolveOrgId(req: ExpressRequest): string | undefined {
  const orgHeader = req.headers['x-org-id'];
  if (typeof orgHeader === 'string' && orgHeader.length > 0) return orgHeader;
  return undefined;
}

@ApiTags('Resumable Evidence Uploads')
@ApiBearerAuth('JWT-auth')
@Controller('evidence/resumable-uploads')
export class ResumableUploadController {
  constructor(private readonly uploads: ResumableUploadService) {}

  @Post()
  @Roles(AppRole.operator, AppRole.admin, AppRole.client)
  @ApiOperation({ summary: 'Create a resumable chunked upload session' })
  @ApiCreatedResponse({ description: 'Upload session created.' })
  create(
    @Body() dto: CreateResumableUploadDto,
    @Request() req: ExpressRequest,
  ) {
    const ownerId = resolveOwner(req);
    const orgId = resolveOrgId(req);
    return this.uploads.create(dto, ownerId, orgId);
  }

  @Get()
  @Roles(AppRole.operator, AppRole.admin, AppRole.client)
  @ApiOperation({ summary: 'List all upload sessions for the caller' })
  @ApiOkResponse({ description: 'Upload list returned.' })
  list(@Request() req: ExpressRequest) {
    const ownerId = resolveOwner(req);
    return this.uploads.listUploads(ownerId);
  }

  @Get('incomplete')
  @Roles(AppRole.operator, AppRole.admin, AppRole.client)
  @ApiOperation({
    summary:
      'List incomplete uploads (server-side reconciled) for post-restart resume',
  })
  @ApiOkResponse({ description: 'Incomplete upload list returned.' })
  listIncomplete(@Request() req: ExpressRequest) {
    const ownerId = resolveOwner(req);
    return this.uploads.listIncompleteForRecovery(ownerId);
  }

  @Get(':id/status')
  @Roles(AppRole.operator, AppRole.admin, AppRole.client)
  @ApiOperation({
    summary:
      'Get detailed upload status including received chunks and progress',
  })
  @ApiOkResponse({ description: 'Upload status returned.' })
  status(@Param('id') id: string, @Request() req: ExpressRequest) {
    const ownerId = resolveOwner(req);
    return this.uploads.getStatus(id, ownerId);
  }

  @Get(':id/verify')
  @Roles(AppRole.operator, AppRole.admin, AppRole.client)
  @ApiOperation({
    summary:
      'Verify server-side chunks (disk integrity) and report any missing/corrupted chunks',
  })
  @ApiOkResponse({ description: 'Verification result returned.' })
  verify(@Param('id') id: string, @Request() req: ExpressRequest) {
    const ownerId = resolveOwner(req);
    return this.uploads.verifyServerSideChunks(id, ownerId);
  }

  @Post(':id/chunks')
  @Roles(AppRole.operator, AppRole.admin, AppRole.client)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('chunk', evidenceMulterOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a single chunk (idempotent)' })
  @ApiOkResponse({ description: 'Chunk received.' })
  async uploadChunk(
    @Param('id') id: string,
    @Body() dto: UploadChunkDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: ExpressRequest,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No chunk data uploaded');
    }
    const ownerId = resolveOwner(req);
    const index = Number(dto.index);
    if (!Number.isInteger(index) || index < 0) {
      throw new BadRequestException('index must be a non-negative integer');
    }
    return this.uploads.uploadChunk(
      id,
      index,
      dto.checksum,
      file.buffer,
      ownerId,
    );
  }

  @Post(':id/resume')
  @Roles(AppRole.operator, AppRole.admin, AppRole.client)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Resume a paused/failed upload. Verifies server chunks and transitions to uploading.',
  })
  @ApiOkResponse({ description: 'Upload resumed.' })
  resume(
    @Param('id') id: string,
    @Body() dto: ResumeUploadDto,
    @Request() req: ExpressRequest,
  ) {
    const ownerId = resolveOwner(req);
    return this.uploads.resume(id, ownerId, dto);
  }

  @Post(':id/pause')
  @Roles(AppRole.operator, AppRole.admin, AppRole.client)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause an in-progress upload.' })
  @ApiOkResponse({ description: 'Upload paused.' })
  pause(@Param('id') id: string, @Request() req: ExpressRequest) {
    const ownerId = resolveOwner(req);
    return this.uploads.pause(id, ownerId);
  }

  @Post(':id/abort')
  @Roles(AppRole.operator, AppRole.admin, AppRole.client)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Abort an upload and discard all chunks.' })
  @ApiOkResponse({ description: 'Upload aborted.' })
  abort(@Param('id') id: string, @Request() req: ExpressRequest) {
    const ownerId = resolveOwner(req);
    return this.uploads.abort(id, ownerId);
  }

  @Post(':id/retry-backoff')
  @Roles(AppRole.operator, AppRole.admin, AppRole.client)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Compute next retry backoff window for the client (exponential capped).',
  })
  @ApiOkResponse({ description: 'Backoff schedule returned.' })
  backoff(@Param('id') id: string, @Request() req: ExpressRequest) {
    const ownerId = resolveOwner(req);
    return this.uploads.computeRetryBackoffMs(id, ownerId);
  }

  @Post(':id/finalize')
  @Roles(AppRole.operator, AppRole.admin, AppRole.client)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Finalize upload: merge chunks, verify total size + whole-file checksum, queue evidence.',
  })
  @ApiOkResponse({ description: 'Upload finalized and evidence queued.' })
  finalize(
    @Param('id') id: string,
    @Body() dto: FinalizeUploadDto,
    @Request() req: ExpressRequest,
  ) {
    const ownerId = resolveOwner(req);
    return this.uploads.finalize(id, dto.fileChecksum, ownerId);
  }
}

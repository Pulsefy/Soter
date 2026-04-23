import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Request,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UploadSessionService } from './upload-session.service';
import {
  CreateUploadSessionDto,
  UploadChunkDto,
  FinalizeUploadSessionDto,
  UploadSessionResponseDto,
} from './dto/upload-session.dto';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import { Request as ExpressRequest } from 'express';

@ApiTags('Upload Sessions')
@ApiBearerAuth('JWT-auth')
@Controller('evidence/upload-sessions')
export class UploadSessionController {
  constructor(private readonly uploadSessionService: UploadSessionService) {}

  @Post()
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    summary: 'Create upload session',
    description:
      'Creates a new resumable upload session for large evidence files. Returns session ID and metadata for chunked uploads.',
  })
  @ApiCreatedResponse({
    description: 'Upload session created successfully',
    type: UploadSessionResponseDto,
  })
  async createSession(
    @Body() dto: CreateUploadSessionDto,
    @Request() req: ExpressRequest,
  ): Promise<UploadSessionResponseDto> {
    const ownerId = req.user?.apiKeyId || req.user?.authType || 'system';
    return this.uploadSessionService.createSession(dto, ownerId);
  }

  @Post(':sessionId/chunks')
  @Roles(AppRole.operator, AppRole.admin)
  @UseInterceptors(FileInterceptor('chunk'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload chunk',
    description:
      'Uploads a single chunk to an existing upload session. Supports retry and resume.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        chunk: {
          type: 'string',
          format: 'binary',
          description: 'The chunk data',
        },
        chunkIndex: {
          type: 'number',
          description: '0-based index of the chunk',
        },
        totalChunks: {
          type: 'number',
          description: 'Total number of chunks',
        },
        chunkHash: {
          type: 'string',
          description: 'SHA256 hash of the chunk data',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Chunk uploaded successfully',
    type: UploadSessionResponseDto,
  })
  async uploadChunk(
    @Param('sessionId') sessionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() chunkDto: UploadChunkDto,
    @Request() req: ExpressRequest,
  ): Promise<UploadSessionResponseDto> {
    const ownerId = req.user?.apiKeyId || req.user?.authType || 'system';
    return this.uploadSessionService.uploadChunk(
      sessionId,
      chunkDto,
      file.buffer,
      ownerId,
    );
  }

  @Post(':sessionId/finalize')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finalize upload session',
    description:
      'Assembles all uploaded chunks and creates an evidence queue item. Validates file integrity.',
  })
  @ApiOkResponse({
    description: 'Upload session finalized successfully',
    type: UploadSessionResponseDto,
  })
  async finalizeSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: FinalizeUploadSessionDto,
    @Request() req: ExpressRequest,
  ): Promise<UploadSessionResponseDto> {
    const ownerId = req.user?.apiKeyId || req.user?.authType || 'system';
    return this.uploadSessionService.finalizeSession(sessionId, dto, ownerId);
  }

  @Get(':sessionId')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    summary: 'Get session status',
    description:
      'Retrieves the current status of an upload session, including uploaded chunks.',
  })
  @ApiOkResponse({
    description: 'Session status retrieved successfully',
    type: UploadSessionResponseDto,
  })
  async getSessionStatus(
    @Param('sessionId') sessionId: string,
    @Request() req: ExpressRequest,
  ): Promise<UploadSessionResponseDto> {
    const ownerId = req.user?.apiKeyId || req.user?.authType || 'system';
    return this.uploadSessionService.getSessionStatus(sessionId, ownerId);
  }

  @Post(':sessionId/cancel')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel upload session',
    description: 'Cancels an upload session and cleans up uploaded chunks.',
  })
  @ApiOkResponse({ description: 'Session cancelled successfully' })
  async cancelSession(
    @Param('sessionId') sessionId: string,
    @Request() req: ExpressRequest,
  ): Promise<{ message: string }> {
    const ownerId = req.user?.apiKeyId || req.user?.authType || 'system';
    return this.uploadSessionService.cancelSession(sessionId, ownerId);
  }
}

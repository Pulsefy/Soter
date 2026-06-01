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
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import { UploadSessionService } from './upload-session.service';
import { CreateUploadSessionDto, UploadChunkDto } from './upload-session.dto';
import { evidenceMulterOptions } from './file-validation';

@ApiTags('Evidence Upload Sessions')
@ApiBearerAuth('JWT-auth')
@Controller('evidence/upload-sessions')
export class UploadSessionController {
  constructor(private readonly uploadSessionService: UploadSessionService) {}

  @Post()
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({ summary: 'Create a chunked upload session' })
  @ApiCreatedResponse({ description: 'Session created.' })
  create(@Body() dto: CreateUploadSessionDto, @Request() req: ExpressRequest) {
    const ownerId = req.user?.apiKeyId ?? req.user?.authType ?? 'system';
    const orgId = (req.headers['x-org-id'] as string) || undefined;
    return this.uploadSessionService.create(dto, ownerId, orgId);
  }

  @Post(':id/chunks')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('chunk', evidenceMulterOptions))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a single chunk' })
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
    const ownerId = req.user?.apiKeyId ?? req.user?.authType ?? 'system';
    const index = Number(dto.index);
    if (!Number.isInteger(index) || index < 0) {
      throw new BadRequestException('index must be a non-negative integer');
    }
    return this.uploadSessionService.uploadChunk(
      id,
      index,
      dto.checksum,
      file.buffer,
      ownerId,
    );
  }

  @Post(':id/finalize')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalize session and assemble evidence file' })
  @ApiOkResponse({ description: 'Evidence queued.' })
  finalize(@Param('id') id: string, @Request() req: ExpressRequest) {
    const ownerId = req.user?.apiKeyId ?? req.user?.authType ?? 'system';
    return this.uploadSessionService.finalize(id, ownerId);
  }

  @Get(':id/status')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({ summary: 'Get received chunks (for resume)' })
  @ApiOkResponse({ description: 'Session status.' })
  status(@Param('id') id: string, @Request() req: ExpressRequest) {
    const ownerId = req.user?.apiKeyId ?? req.user?.authType ?? 'system';
    return this.uploadSessionService.getStatus(id, ownerId);
  }
}

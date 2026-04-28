import { Controller, Post, Body, Param, Put, UploadedFile, UseInterceptors, ParseIntPipe, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiOkResponse, ApiCreatedResponse, ApiParam } from '@nestjs/swagger';
import { UploadsService } from './uploads.service';
import { CreateUploadSessionDto } from './dto/create-upload-session.dto';
import { FinalizeUploadDto } from './dto/finalize-upload.dto';

@ApiTags('Uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('session')
  @ApiOperation({ summary: 'Create an upload session for evidence' })
  @ApiCreatedResponse({ description: 'Upload session created successfully.' })
  async createSession(@Body() dto: CreateUploadSessionDto) {
    return this.uploadsService.createSession(dto);
  }

  @Put('session/:id/chunks/:chunkIndex')
  @ApiOperation({ summary: 'Upload a chunk for a specific session' })
  @ApiParam({ name: 'id', description: 'Upload session ID' })
  @ApiParam({ name: 'chunkIndex', description: '0-based index of the chunk' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadChunk(
    @Param('id') id: string,
    @Param('chunkIndex', ParseIntPipe) chunkIndex: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('File chunk is required');
    }
    return this.uploadsService.uploadChunk(id, chunkIndex, file.size, file.buffer);
  }

  @Post('session/:id/finalize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalize an upload session' })
  @ApiOkResponse({ description: 'Upload session finalized successfully.' })
  async finalizeSession(
    @Param('id') id: string,
    @Body() dto: FinalizeUploadDto,
  ) {
    return this.uploadsService.finalizeSession(id, dto.ownerId);
  }
}

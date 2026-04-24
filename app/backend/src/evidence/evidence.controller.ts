import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
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
import { EvidenceService } from './evidence.service';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';

@ApiTags('Evidence Queue')
@ApiBearerAuth('JWT-auth')
@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  @Post('upload')
  @Roles(AppRole.operator, AppRole.admin)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload evidence to queue',
    description: 'Encrypts and stores evidence locally for eventual upload.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiCreatedResponse({ description: 'Evidence queued successfully.' })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: ExpressRequest,
  ) {
    const ownerId = req.user?.apiKeyId || req.user?.authType || 'system';
    return this.evidenceService.queueEvidence(file, ownerId);
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
}

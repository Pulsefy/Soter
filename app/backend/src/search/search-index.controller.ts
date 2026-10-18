import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AppRole } from '@prisma/client';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AdaptiveRateLimitGuard } from '../common/guards/adaptive-rate-limit.guard';
import { SearchIndexService, RebuildProgress } from './search-index.service';
import { StartSearchIndexRebuildDto } from './dto/start-search-index-rebuild.dto';

interface SearchIndexUser {
  apiKeyId?: string;
  authType?: string;
  role?: string;
}

@ApiTags('Admin Search Index')
@ApiBearerAuth('JWT-auth')
@Controller('admin/search-index')
@UseGuards(ApiKeyGuard, RolesGuard, AdaptiveRateLimitGuard)
export class SearchIndexController {
  constructor(private readonly searchIndexService: SearchIndexService) {}

  @Post('rebuild')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Trigger a search index rebuild (or dry run)',
    description:
      'Rebuilds the materialized search index in bounded batches without ' +
      'blocking live search. Progress is persisted and resumable. Concurrent ' +
      'rebuild requests are rejected with 409.',
  })
  async startRebuild(
    @Body() dto: StartSearchIndexRebuildDto,
    @Req() req: Request,
  ): Promise<RebuildProgress> {
    const user = req.user as SearchIndexUser | undefined;
    return this.searchIndexService.startRebuild({
      ...dto,
      triggeredBy: this.actorId(user),
    });
  }

  @Get('rebuild')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Get the most recent search index rebuild',
    description:
      'Returns the latest rebuild run (running, completed, or failed) with ' +
      'progress and checkpoint information, or null when none has run yet.',
  })
  async latestBuild(): Promise<RebuildProgress | null> {
    return this.searchIndexService.getLatestProgress();
  }

  @Get('rebuild/:id')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Get search index rebuild progress',
    description:
      'Returns progress for a specific rebuild run, including processed ' +
      'documents, percent, per-entity statistics, and its checkpoint.',
  })
  @ApiParam({ name: 'id', description: 'Search index build ID' })
  async getBuild(@Param('id') id: string): Promise<RebuildProgress> {
    return this.searchIndexService.getProgress(id);
  }

  private actorId(user: SearchIndexUser | undefined): string | undefined {
    return user?.apiKeyId ?? user?.authType ?? user?.role;
  }
}

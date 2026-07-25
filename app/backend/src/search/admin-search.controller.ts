import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { AdminSearchService } from './admin-search.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '@prisma/client';
import { AdaptiveRateLimitGuard } from '../common/guards/adaptive-rate-limit.guard';

interface SearchUser {
  orgId?: string | null;
  ngoId?: string | null;
}

@Controller('admin')
@UseGuards(ApiKeyGuard, RolesGuard, AdaptiveRateLimitGuard)
export class AdminSearchController {
  constructor(private readonly searchService: AdminSearchService) {}

  @Get('search')
  @Roles(AppRole.admin, AppRole.ngo)
  async search(
    @Query('q') query: string,
    @Query('entity') entity: string,
    @Req() req: Request,
  ) {
    const user = req.user as SearchUser | undefined;
    const orgId: string = user?.orgId ?? user?.ngoId ?? '';
    return this.searchService.search(query, entity, orgId);
  }
}

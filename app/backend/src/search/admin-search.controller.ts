import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { AdminSearchService } from './admin-search.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '@prisma/client';
import { AdaptiveRateLimitGuard } from '../common/guards/adaptive-rate-limit.guard';

@Controller('admin')
@UseGuards(ApiKeyGuard, RolesGuard, AdaptiveRateLimitGuard)
export class AdminSearchController {
  constructor(private readonly searchService: AdminSearchService) {}

  @Get('search')
  @Roles(AppRole.admin, AppRole.ngo)
  async search(
    @Query('q') query: string,
    @Query('entity') entity: string,
    @Request() req: any,
  ) {
    const orgId = req.user.orgId || req.user.ngoId;
    return this.searchService.search(query, entity, orgId);
  }
}

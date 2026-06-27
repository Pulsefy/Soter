import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { AdminSearchService } from './admin-search.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '@prisma/client';
import { AdaptiveRateLimitGuard } from '../common/guards/adaptive-rate-limit.guard';

interface AuthenticatedUser {
  orgId?: string;
  ngoId?: string;
}

type AuthenticatedRequest = ExpressRequest & { user: AuthenticatedUser };

@Controller('admin')
@UseGuards(ApiKeyGuard, RolesGuard, AdaptiveRateLimitGuard)
export class AdminSearchController {
  constructor(private readonly searchService: AdminSearchService) {}

  @Get('search')
  @Roles(AppRole.admin, AppRole.ngo)
  async search(
    @Query('q') query: string,
    @Query('entity') entity: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const orgId = req.user.orgId ?? req.user.ngoId ?? '';
    return this.searchService.search(query, entity, orgId);
  }
}

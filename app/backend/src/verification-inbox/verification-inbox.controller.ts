import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { VerificationInboxService } from './verification-inbox.service';
import { QueryInboxDto } from './dto/query-inbox.dto';
import { VerificationInboxListDto, VerificationInboxItemDto } from './dto/verification-inbox-response.dto';

/**
 * VerificationInboxController
 *
 * Exposes stable REST endpoints for Testnet demo clients to fetch
 * verification statuses scoped to their organisation.
 *
 * Base path: /api/verification-inbox
 *
 * Endpoints:
 *   GET  /api/verification-inbox            → list (filterable)
 *   GET  /api/verification-inbox/:id        → detail
 *
 * Auth:
 *   JwtAuthGuard is commented out for Testnet demo mode.
 *   Uncomment @UseGuards(JwtAuthGuard) and the orgId extraction once
 *   the auth module is integrated.
 *
 * Org/role enforcement is handled inside the service layer, not here,
 * so the controller stays thin and the business rule is testable.
 */

// import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/verification-inbox')
// @UseGuards(JwtAuthGuard)
export class VerificationInboxController {
  constructor(private readonly verificationInboxService: VerificationInboxService) {}

  /**
   * GET /api/verification-inbox
   *
   * Returns a paginated list of verification inbox items for the caller's org.
   *
   * Query params:
   *   status  – filter by 'pending' | 'approved' | 'rejected'
   *   from    – ISO date string, lower bound on createdAt (inclusive)
   *   to      – ISO date string, upper bound on createdAt (inclusive, full day)
   *   limit   – max items per page (default 20, max 100)
   *   offset  – pagination offset (default 0)
   *
   * Example:
   *   GET /api/verification-inbox?status=pending&from=2024-06-01&limit=10
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  findAll(@Query() query: QueryInboxDto, @Req() req: any): VerificationInboxListDto {
    // TODO: replace with real auth extraction once JwtAuthGuard is active
    // const orgId = req.user.orgId;
    const orgId = req.user?.orgId ?? 'org-alpha'; // Testnet demo default
    return this.verificationInboxService.findAll(orgId, query);
  }

  /**
   * GET /api/verification-inbox/:id
   *
   * Returns a single verification inbox item.
   * Returns 404 if not found, 403 if the item belongs to a different org.
   *
   * Example:
   *   GET /api/verification-inbox/vi-001
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id') id: string, @Req() req: any): VerificationInboxItemDto {
    const orgId = req.user?.orgId ?? 'org-alpha'; // Testnet demo default
    return this.verificationInboxService.findOne(orgId, id);
  }
}
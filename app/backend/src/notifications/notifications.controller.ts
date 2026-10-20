import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import { ApiResponseDto } from '../common/dto/api-response.dto';

interface AuthenticatedUser {
  role?: string;
  ngoId?: string;
  orgId?: string;
}

/**
 * Callers bound to an organisation only see that organisation's notification
 * outbox rows in the feed; platform admins (no org context) see everything.
 */
function extractOrgId(req: ExpressRequest): string | undefined {
  const user = req.user as AuthenticatedUser | undefined;
  if (!user) return undefined;
  if (user.role === AppRole.admin) return undefined;
  return user.orgId ?? user.ngoId ?? undefined;
}

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@UseGuards(ApiKeyGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('activity-feed')
  @Roles(AppRole.admin, AppRole.operator)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List operational activity feed items',
    description:
      'Returns recent notification outbox records, audit events, and verification review updates for the Activity Center.',
  })
  @ApiOkResponse({ description: 'Activity feed returned.' })
  async listActivityFeed(
    @Request() request: ExpressRequest,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : 30;
    const records = await this.notificationsService.getActivityFeed(
      Number.isFinite(parsedLimit) ? parsedLimit : 30,
      extractOrgId(request),
    );
    return ApiResponseDto.ok(records, 'Activity feed fetched');
  }
}

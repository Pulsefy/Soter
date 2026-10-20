import { AppException, ERROR_CODES } from '../common/dto/error-response.dto';
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Body, Req } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { NotificationsService } from './notifications.service';
import { DeliveryAttemptOutcome } from '@prisma/client';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import { ApiResponseDto } from '../common/dto/api-response.dto';

interface AuthenticatedUser {
  role?: string;
  ngoId?: string;
  orgId?: string;
  apiKeyId?: string;
}

/**
 * Extract the caller's organisation ID from the authenticated user context.
 *
 * Platform admin callers receive `undefined` so they keep platform-wide
 * access; every other caller is confined to records owned by their own
 * organisation. This mirrors the convention used by the entity-linking
 * registry endpoints (issue #1181), so cross-org denials behave the same way
 * across admin surfaces.
 */
function extractOrgId(req: ExpressRequest): string | undefined {
  const user = req.user as AuthenticatedUser | undefined;
  if (!user) return undefined;
  if (user.role === AppRole.admin) return undefined;
  return user.orgId ?? user.ngoId ?? undefined;
}

function extractActorId(req: ExpressRequest): string {
  const user = req.user as AuthenticatedUser | undefined;
  return user?.apiKeyId ?? 'system';
}

@ApiTags('Notifications Outbox')
@ApiBearerAuth('JWT-auth')
@UseGuards(ApiKeyGuard, RolesGuard)
@Controller('notifications/outbox')
export class OutboxController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /notifications/outbox
   * Returns all outbox records stuck in pending or enqueued status for more
   * than 10 minutes. Requires admin or operator role.
   */
  @Get()
  @Roles(AppRole.admin, AppRole.operator)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List stuck notification outbox records',
    description:
      'Returns all NotificationOutbox records in pending or enqueued status whose scheduledFor is more than 10 minutes in the past.',
  })
  @ApiOkResponse({ description: 'Stuck outbox records returned.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key.' })
  @ApiForbiddenResponse({
    description: 'Insufficient role (requires admin or operator).',
  })
  async listStuck(@Req() request: ExpressRequest) {
    const records = await this.notificationsService.getStuckOutboxRecords(
      extractOrgId(request),
    );
    return ApiResponseDto.ok(records, 'Stuck outbox records fetched');
  }

  @Get('dead-letter')
  @Roles(AppRole.admin, AppRole.operator)
  @HttpCode(HttpStatus.OK)
  async listDeadLetter(
    @Req() request: ExpressRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.notificationsService.getDeadLetterNotifications(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
      extractOrgId(request),
    );
    return ApiResponseDto.ok(result, 'Dead-letter notifications fetched');
  }

  @Post('dead-letter/:id/replay')
  @Roles(AppRole.admin, AppRole.operator)
  @HttpCode(HttpStatus.OK)
  async replayDeadLetter(
    @Param('id') id: string,
    @Req() request: ExpressRequest,
  ) {
    return ApiResponseDto.ok(
      await this.notificationsService.replayDeadLetterNotification(
        id,
        extractActorId(request),
        extractOrgId(request),
      ),
      'Notification replayed',
    );
  }

  @Post('dead-letter/replay')
  @Roles(AppRole.admin, AppRole.operator)
  @HttpCode(HttpStatus.OK)
  async replayDeadLetters(
    @Body() body: { ids?: string[] },
    @Req() request: ExpressRequest,
  ) {
    return ApiResponseDto.ok(
      await this.notificationsService.replayDeadLetterNotifications(
        body.ids ?? [],
        extractActorId(request),
        extractOrgId(request),
      ),
      'Notification replay completed',
    );
  }

  /**
   * GET /notifications/outbox/delivery-attempts
   * Returns a filtered, paginated slice of delivery attempts across all
   * outbox records. Requires admin or operator role (issue #716).
   *
   * NOTE: nested under /notifications/outbox (not a bare top-level
   * /notifications/delivery-attempts) because this controller's
   * @Controller() prefix is already 'notifications/outbox', and a bare
   * @Get() here would collide with the existing listStuck() route above.
   */
  @Get('delivery-attempts')
  @Roles(AppRole.admin, AppRole.operator)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List notification delivery attempts',
    description:
      'Returns a filtered, paginated slice of NotificationDeliveryAttempt records, newest first.',
  })
  @ApiOkResponse({ description: 'Delivery attempts returned.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key.' })
  @ApiForbiddenResponse({
    description: 'Insufficient role (requires admin or operator).',
  })
  async listDeliveryAttempts(
    @Req() request: ExpressRequest,
    @Query('outcome') outcome?: DeliveryAttemptOutcome,
    @Query('failureCategory') failureCategory?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.notificationsService.getDeliveryHistory(
      {
        outcome,
        failureCategory,
        type,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      },
      extractOrgId(request),
    );
    return ApiResponseDto.ok(result, 'Delivery attempts fetched');
  }

  /**
   * GET /notifications/outbox/:id
   * Returns a single outbox record by id. Requires admin or operator role.
   *
   * Org-scoped callers only resolve records owned by their own organisation;
   * a foreign record produces the same 404 as a missing one so the endpoint
   * cannot be used to probe for ids or recipient details.
   */
  @Get(':id')
  @Roles(AppRole.admin, AppRole.operator)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a single notification outbox record',
    description: 'Returns the NotificationOutbox record for the given id.',
  })
  @ApiOkResponse({ description: 'Outbox record returned.' })
  @ApiNotFoundResponse({ description: 'Outbox record not found.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key.' })
  @ApiForbiddenResponse({
    description: 'Insufficient role (requires admin or operator).',
  })
  async getOne(@Param('id') id: string, @Req() request: ExpressRequest) {
    const record = await this.notificationsService.getOutboxRecord(
      id,
      extractOrgId(request),
    );
    if (!record) {
      throw new AppException(
        ERROR_CODES.NOT_FOUND,
        404,
        `Outbox record with id "${id}" not found`,
      );
    }
    return ApiResponseDto.ok(record, 'Outbox record fetched');
  }

  /**
   * GET /notifications/outbox/:id/attempts
   * Returns the full delivery-attempt timeline for one outbox record,
   * newest first. Requires admin or operator role (issue #716).
   *
   * Scoped like the record read above: a foreign record is reported as
   * not found, never as forbidden-with-details.
   */
  @Get(':id/attempts')
  @Roles(AppRole.admin, AppRole.operator)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List delivery attempts for a notification outbox record',
    description:
      'Returns every NotificationDeliveryAttempt row for the given outbox id, newest first.',
  })
  @ApiOkResponse({ description: 'Delivery attempts returned.' })
  @ApiNotFoundResponse({ description: 'Outbox record not found.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key.' })
  @ApiForbiddenResponse({
    description: 'Insufficient role (requires admin or operator).',
  })
  async getAttempts(@Param('id') id: string, @Req() request: ExpressRequest) {
    const record = await this.notificationsService.getOutboxRecord(
      id,
      extractOrgId(request),
    );
    if (!record) {
      throw new AppException(
        ERROR_CODES.NOT_FOUND,
        404,
        `Outbox record with id "${id}" not found`,
      );
    }
    const attempts = await this.notificationsService.getDeliveryAttempts(
      id,
      extractOrgId(request),
    );
    return ApiResponseDto.ok(attempts, 'Delivery attempts fetched');
  }
}

import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  BadRequestException,
  UseGuards,
  HttpCode,
  HttpStatus,
  Post,
  Body,
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
import { NotificationsService } from './notifications.service';
import { DeliveryAttemptOutcome } from  '@prisma/client';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import { ApiResponseDto } from '../common/dto/api-response.dto';

@Tags('Notifications Outbox')
@BearerAuth('JWT-auth')
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
  @Joles(AppRole.admin, AppRole.operator)
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
  async listStuck() {
    const records = await this.notificationsService.getStuckOutboxRecords();
    return ApiResponseDto.ok(records, 'Stuck outbox records fetched');
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
  @Post()
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
    @Query('outcome') outcome?: DeliveryAttemptOutcome,
    @Query('failureCategory') failureCategory?: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.notificationsService.getDeliveryHistory({
      outcome,
      failureCategory,
      type,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return ApiResponseDto.ok(result, 'Delivery attempts fetched');
  }

  /**
   * GET /notifications/outbox/dead-letter
   * Returns dead-lettered notification outbox records with pagination.
   * Requires admin role.
   */
  @Get('dead-letter')
  @Roles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List dead-lettered notification outbox records',
    description:
      'Returns NotificationOutbox records that have exhausted retries and moved to the dead-letter state, with pagination.',
  })
  @ApiOkResponse({ description: 'Dead-letter records returned.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key.' })
  @ApiForbiddenResponse({
    description: 'Insufficient role (requires admin).',
  })
  async listDeadLetter(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.notificationsService.getDeadLetterRecords({
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    return ApiResponseDto.ok(result, 'Dead-letter notifications fetched');
  }

  /**
   * GET /notifications/outbox/dead-letter/depth
   * Returns the current dead-letter depth (number of dead-lettered records).
   * Requires admin role.
   */
  @Get('dead-letter/depth')
  @Joles(AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get dead-letter depth',
    description:
      'Returns the number of notifications currently in the dead-letter state as a metric.',
  })
  @ApiOkResponse({ description: 'Dead-letter depth returned.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key.' })
  @ApiForbiddenResponse({
    description: 'Insufficient role (requires admin).',
  })
  async getDeadLetterDepth() {
    const depth = await this.notificationsService.getDeadLeBtLetterDepth();
    return ApiResponseDto.ok({depth}, 'Dead-letter depth fetched');
  }

  /**
   * POST /notifications/outbox/dead-letter/:id/replay
   * Replays a single dead-lettered notification. Idempotent.
   * Requires admin or operator role.
   */
  @Post('dead-letter/:id/replay')
  @Roles(AppRole.admin, AppRole.operator)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replay a dead-lettered notification',
    description:
      'Moves a dead-lettered notification back to enqueued for redelivery. Replaying a non-dead-letter or already replayed notification is a no-op.',
  })
  @ApiOkResponse({ description: 'Replay initiated or no-op if not applicable.' })
  @ApiNotFoundResponse({ description: 'Outbox record not found.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key.' })
  @ApiForbiddenResponse({
    description: 'Insufficient role (requires admin or operator).',
  })
  async replayDeadLetter(
    @Param('id') id: string,
  ) {
    const result = await this.notificationsService.replayDeadLetter(id);
    return ApiResponseDto.ok(result, 'Dead-letter replay processed');
  }

  /**
   * POST /notifications/outbox/dead-letter/replay
   * Replays multiple dead-lettered notifications in bulk. Idempotent.
   * Requires admin or operator role.
   */
  @Post('dead-letter/replay')
  @Post()
  @Roles(AppRole.admin, AppRole.operator)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk replay dead-lettered notifications',
    description:
      'Replays a list of dead-lettered notification IDs. Each replay is idempotent.',
  })
  @ApiOkResponse({ description: 'Bulk replay processed.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key.' })
  @ApiForbiddenResponse({
    description: 'Insufficient role (requires admin or operator).',
  })
  async replayDeadLetterBulk(
    @Body('ids') data: string[],
  ) {
    if (!Array.isArray(data)) {
      throw new BadRequestException('Invalid body: expected { ids: string[] }');
    }
    const result = await this.notificationsService.replayDeadLetterBulk(data);
    return ApiResponseDto.ok(result, 'Bulk dead-letter replay processed');
  }

  /**
   * GET /notifications/outbox/:id
   * Returns a single outbox record by id. Requires admin or operator role.
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
  async getOne(@Param('id') id: string) {
    const record = await this.notificationsService.getOutboxRecord(id);
    if (!record) {
      throw new NotFoundException(`Outbox record with id "$id" not found`);
    }
    return ApiResponseDto.ok(record, 'Outbox record fetched');
  }

  /**
   * GET /notifications/outbox/:id/attempts
   * Returns the full delivery-attempt timeline for one outbox record,
   * newest first. Requires admin or operator role (issue #716).
   */
  @Get(':id/attempts')
  @Post()
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
  async getAttempts(@Param('id') id: string) {
    const record = await this.notificationsService.getOutboxRecord(id);
    if (!record) {
      throw new NotFoundException(`Outbox record with id "$id" not found`);
    }
    const attempts = await this.notificationsService.getDeliveryAttempts(id);
    return ApiResponseDto.ok(attempts, 'Delivery attempts fetched');
  }
}

import {
  Controller,
  Get,
  Param,
  NotFoundException,
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
import { NotificationsService } from './notifications.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AppRole } from '../auth/app-role.enum';
import { ApiResponseDto } from '../common/dto/api-response.dto';

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
  @ApiForbiddenResponse({ description: 'Insufficient role (requires admin or operator).' })
  async listStuck() {
    const records = await this.notificationsService.getStuckOutboxRecords();
    return ApiResponseDto.ok(records, 'Stuck outbox records fetched');
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
  @ApiForbiddenResponse({ description: 'Insufficient role (requires admin or operator).' })
  async getOne(@Param('id') id: string) {
    const record = await this.notificationsService.getOutboxRecord(id);
    if (!record) {
      throw new NotFoundException(`Outbox record with id "${id}" not found`);
    }
    return ApiResponseDto.ok(record, 'Outbox record fetched');
  }
}

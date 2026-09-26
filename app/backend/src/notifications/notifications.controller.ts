import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
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
  async listActivityFeed(@Query('limit') limit?: string) {
    const parsedLimit = limit ? Number(limit) : 30;
    const records = await this.notificationsService.getActivityFeed(
      Number.isFinite(parsedLimit) ? parsedLimit : 30,
    );
    return ApiResponseDto.ok(records, 'Activity feed fetched');
  }
}

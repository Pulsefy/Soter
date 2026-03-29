import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ApiResponseDto } from '../common/dto/api-response.dto';
import { AppRole } from '../auth/app-role.enum';
import { Roles } from '../auth/roles.decorator';
import { CreateWebhookSubscriptionDto } from './dto/create-webhook-subscription.dto';
import { UpdateWebhookSubscriptionDto } from './dto/update-webhook-subscription.dto';
import { WebhookSubscriptionResponseDto } from './dto/webhook-subscription-response.dto';
import { WebhooksService } from './webhooks.service';

@ApiTags('Webhooks')
@ApiBearerAuth('JWT-auth')
@Roles(AppRole.ngo, AppRole.admin)
@Controller('webhooks/subscriptions')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  @ApiOkResponse({
    description: 'Webhook subscriptions fetched successfully.',
    type: WebhookSubscriptionResponseDto,
    isArray: true,
  })
  async list(@Req() req: Request) {
    const subscriptions = await this.webhooksService.listSubscriptions(
      this.requireApiKeyId(req),
    );
    return ApiResponseDto.ok(
      subscriptions,
      'Webhook subscriptions fetched successfully',
    );
  }

  @Post()
  @ApiCreatedResponse({
    description: 'Webhook subscription created successfully.',
    type: WebhookSubscriptionResponseDto,
  })
  async create(
    @Req() req: Request,
    @Body() dto: CreateWebhookSubscriptionDto,
  ) {
    const subscription = await this.webhooksService.createSubscription(
      this.requireApiKeyId(req),
      dto,
    );

    return ApiResponseDto.ok(
      subscription,
      'Webhook subscription created successfully',
    );
  }

  @Patch(':id')
  @ApiOkResponse({
    description: 'Webhook subscription updated successfully.',
    type: WebhookSubscriptionResponseDto,
  })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookSubscriptionDto,
  ) {
    const subscription = await this.webhooksService.updateSubscription(
      this.requireApiKeyId(req),
      id,
      dto,
    );

    return ApiResponseDto.ok(
      subscription,
      'Webhook subscription updated successfully',
    );
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Webhook subscription deleted successfully.' })
  async remove(@Req() req: Request, @Param('id') id: string) {
    await this.webhooksService.deleteSubscription(this.requireApiKeyId(req), id);
    return ApiResponseDto.ok(null, 'Webhook subscription deleted successfully');
  }

  private requireApiKeyId(req: Request): string {
    const apiKeyId = req.user?.apiKeyId;

    if (!apiKeyId) {
      throw new ForbiddenException(
        'A persisted API key is required to manage webhook subscriptions',
      );
    }

    return apiKeyId;
  }
}

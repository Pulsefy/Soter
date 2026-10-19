import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { AidService } from './aid/aid.service';
import { WebhookHmacGuard } from './common/guards/webhook-hmac.guard';
import { ValidateBody } from './common/interceptors/validate-body.interceptor';
import { AiVerificationWebhookDto } from './webhooks/dto/ai-verification-webhook.dto';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly aidService: AidService) {}

  @Post('ai-verification')
  // Order matters: guard (authenticity, 401) -> interceptor (shape, 400) ->
  // pipes -> handler. HMAC proves who sent the body, not that it is well formed.
  @UseGuards(WebhookHmacGuard)
  @UseInterceptors(ValidateBody(AiVerificationWebhookDto))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive AI verification results' })
  @ApiHeader({
    name: 'X-Signature-256',
    description: 'Hex HMAC-SHA256 signature of the raw request body.',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully.' })
  @ApiResponse({
    status: 400,
    description:
      'Validly signed but malformed payload (missing/invalid/unknown fields).',
  })
  @ApiResponse({ status: 401, description: 'Invalid signature.' })
  async handleAiVerification(@Body() payload: AiVerificationWebhookDto) {
    return this.aidService.handleTaskWebhook(payload);
  }
}

import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { HmacGuard } from '../common/guards/hmac.guard';
import { AiVerificationPayloadDto } from './ai-verification.dto';
import { WebhooksService } from './webhooks.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('ai-verification')
  @UseGuards(HmacGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive AI verification results',
    description:
      'A secure endpoint for AI services to post back verification results. Requires HMAC signature.',
  })
  @ApiHeader({
    name: 'X-Signature-Hmac-Sha256',
    description: 'HMAC-SHA256 signature of the raw request body.',
    required: true,
  })
  @ApiOkResponse({
    description: 'Webhook received and processed successfully.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or missing HMAC signature.',
  })
  async handleAiVerification(@Body() payload: AiVerificationPayloadDto) {
    return this.webhooksService.handleAiVerification(payload);
  }
}

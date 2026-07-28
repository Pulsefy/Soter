import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { HmacAuthGuard } from './hmac-auth.guard';
import { AiVerificationPayloadDto } from 'src/ai-verification.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('ai-verification')
  @UseGuards(HmacAuthGuard) // Correctly typed guard
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive AI verification results' })
  @ApiHeader({
    name: 'X-Signature-256',
    description: 'HMAC SHA256 signature of the request body.',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully.' })
  @ApiResponse({ status: 401, description: 'Invalid signature.' })
  @ApiResponse({ status: 409, description: 'Event already processed.' })
  async handleAiVerification(@Body() payload: AiVerificationPayloadDto) {
    return this.webhooksService.processAiVerification(payload);
  }
}

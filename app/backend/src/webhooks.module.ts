import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { AidModule } from './aid/aid.module';
import { HmacModule } from './common/hmac/hmac.module';
import { WebhookHmacGuard } from './common/guards/webhook-hmac.guard';

@Module({
  imports: [AidModule, HmacModule],
  controllers: [WebhooksController],
  providers: [WebhookHmacGuard],
})
export class WebhooksModule {}

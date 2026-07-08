import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { WebhookController } from './webhook.controller';
import { WebhooksService } from '../webhooks/webhooks.service';

@Module({
  imports: [SessionModule],
  controllers: [WebhookController],
  providers: [WebhooksService],
})
export class WebhookModule {}

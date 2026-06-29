import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [SessionModule],
  controllers: [WebhookController],
})
export class WebhookModule {}

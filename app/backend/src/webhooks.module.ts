import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { SessionModule } from './session/session.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [SessionModule, PrismaModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}

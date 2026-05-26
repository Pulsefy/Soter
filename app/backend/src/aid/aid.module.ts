import { Module } from '@nestjs/common';
import { AidService } from './aid.service';
import { AidController } from './aid.controller';
import { RedisService } from 'cache/redis.service';
import { HmacModule } from '../common/hmac/hmac.module';
import { WebhookHmacGuard } from '../common/guards/webhook-hmac.guard';

@Module({
  imports: [HmacModule],
  providers: [AidService, RedisService, WebhookHmacGuard],
  controllers: [AidController],
  exports: [AidService],
})
export class AidModule {}

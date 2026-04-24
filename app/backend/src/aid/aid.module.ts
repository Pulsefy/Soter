import { Module } from '@nestjs/common';
import { AidService } from './aid.service';
import { AidController } from './aid.controller';
import { RedisService } from 'cache/redis.service';

@Module({
  providers: [AidService, RedisService],
  controllers: [AidController],
  exports: [AidService],
})
export class AidModule {}

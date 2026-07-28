import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

const isRedisEnabled = process.env.REDIS_ENABLED === 'true';

@Module({
  imports: [
    TerminusModule,
    HttpModule,
    ...(isRedisEnabled
      ? [BullModule.registerQueue({ name: 'default' })]
      : []),
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}

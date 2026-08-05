import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import {
  ApiKeyExpiryProcessor,
  API_KEY_EXPIRY_QUEUE,
} from './api-key-expiry.processor';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: API_KEY_EXPIRY_QUEUE }),
  ],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyExpiryProcessor],
  exports: [ApiKeysService],
})
export class ApiKeysModule implements OnModuleInit {
  constructor(
    @InjectQueue(API_KEY_EXPIRY_QUEUE)
    private readonly apiKeyExpiryQueue: Queue,
  ) {}

  async onModuleInit() {
    // Surface upcoming API key expirations every hour.
    await this.apiKeyExpiryQueue.add(
      'check-expiry',
      {},
      {
        repeat: { pattern: '0 * * * *' },
        removeOnComplete: true,
      },
    );
  }
}

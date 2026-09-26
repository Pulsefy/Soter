import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ApiKeysService } from './api-keys.service';

export const API_KEY_EXPIRY_QUEUE = 'api-key-expiry';

@Processor(API_KEY_EXPIRY_QUEUE)
export class ApiKeyExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(ApiKeyExpiryProcessor.name);

  constructor(private readonly apiKeys: ApiKeysService) {
    super();
  }

  async process(job: Job): Promise<{ reminded: number }> {
    this.logger.log(`Processing API key expiry reminders (Job: ${job.id})`);
    const reminders = await this.apiKeys.surfaceUpcomingExpirations();
    return { reminded: reminders.length };
  }
}

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;

  async onModuleInit() {
    const isTest =
      process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
    const hasDatabaseUrl = !!process.env.DATABASE_URL;

    if (isTest && !hasDatabaseUrl) {
      return;
    }

    try {
      await this.$connect();
      this.connected = true;
    } catch (err) {
      this.connected = false;
      if (err instanceof Error) {
        this.logger.error('Failed to connect on startup', err);
      } else {
        this.logger.error('Failed to connect on startup', String(err));
      }
    }
  }

  isConnected() {
    return this.connected;
  }

  async onModuleDestroy() {
    if (!this.connected) {
      return;
    }

    await this.$disconnect();
  }
}

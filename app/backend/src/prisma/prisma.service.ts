import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;

  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://soter_user:soter123@localhost:5432/soter_db',
      }),
    });
  }

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
      this.logger.error('Failed to connect on startup', err as Error);
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

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RecipientImportController } from './recipient-import.controller';
import { RecipientImportService } from './recipient-import.service';
import { RecipientImportProcessor } from './recipient-import.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ClaimsModule } from '../claims/claims.module';

const skipBackgroundJobs = process.env.SKIP_BACKGROUND_JOBS === 'true';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    ClaimsModule,
    ...(skipBackgroundJobs
      ? []
      : [
          BullModule.registerQueueAsync({
            name: 'recipient-import',
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => ({
              connection: {
                host: configService.get<string>('REDIS_HOST') || 'localhost',
                port: parseInt(
                  configService.get<string>('REDIS_PORT') || '6379',
                ),
              },
            }),
            inject: [ConfigService],
          }),
        ]),
  ],
  controllers: [RecipientImportController],
  providers: [RecipientImportService, RecipientImportProcessor],
  exports: [RecipientImportService],
})
export class RecipientImportModule {}

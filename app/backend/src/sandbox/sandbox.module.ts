import { Module } from '@nestjs/common';
import { SandboxService } from './sandbox.service';
import { SandboxController } from './sandbox.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../logger/logger.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, LoggerModule, ConfigModule],
  providers: [SandboxService],
  controllers: [SandboxController],
})
export class SandboxModule {}

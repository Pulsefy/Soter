import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VersionConfigController } from './version-config.controller';
import { VersionConfigService } from './version-config.service';

@Module({
  imports: [PrismaModule],
  controllers: [VersionConfigController],
  providers: [VersionConfigService],
  exports: [VersionConfigService],
})
export class VersionConfigModule {}

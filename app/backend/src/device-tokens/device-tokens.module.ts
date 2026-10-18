import { Module } from '@nestjs/common';
import { DeviceTokensService } from './device-tokens.service';
import { DeviceTokensController } from './device-tokens.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DeviceTokensController],
  providers: [DeviceTokensService],
  exports: [DeviceTokensService],
})
export class DeviceTokensModule {}

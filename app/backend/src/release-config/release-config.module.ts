import { Module } from '@nestjs/common';
import { ReleaseConfigController } from './release-config.controller';
import { ReleaseConfigService } from './release-config.service';

@Module({
  controllers: [ReleaseConfigController],
  providers: [ReleaseConfigService],
})
export class ReleaseConfigModule {}

import { Module } from '@nestjs/common';
import { AidService } from './aid.service';
import { AidController } from './aid.controller';

@Module({
  providers: [AidService],
  controllers: [AidController],
  exports: [AidService],
})
export class AidModule {}

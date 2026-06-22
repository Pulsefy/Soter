import { Module } from '@nestjs/common';
import { HmacService } from './hmac.service';

@Module({
  providers: [HmacService],
  exports: [HmacService],
})
export class HmacModule {}

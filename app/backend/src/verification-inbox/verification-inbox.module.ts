import { Module } from '@nestjs/common';
import { VerificationInboxController } from './verification-inbox.controller';
import { VerificationInboxService } from './verification-inbox.service';

@Module({
  controllers: [VerificationInboxController],
  providers: [VerificationInboxService],
  exports: [VerificationInboxService],
})
export class VerificationInboxModule {}
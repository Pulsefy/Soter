import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RecipientsController } from './recipients.controller';
import { RecipientsService } from './recipients.service';

@Module({
  imports: [PrismaModule],
  controllers: [RecipientsController],
  providers: [RecipientsService],
  exports: [RecipientsService],
})
export class RecipientsModule {}

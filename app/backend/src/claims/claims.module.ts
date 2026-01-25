import { Module } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { ClaimsController } from './claims.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  controllers: [ClaimsController],
  providers: [ClaimsService],
  imports: [PrismaModule],
})
export class ClaimsModule {}

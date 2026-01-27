import { Module } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { ClaimsController } from './claims.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
})
export class ClaimsModule {}

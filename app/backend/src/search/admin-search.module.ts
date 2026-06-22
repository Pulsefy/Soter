import { Module } from '@nestjs/common';
import { AdminSearchService } from './admin-search.service';
import { AdminSearchController } from './admin-search.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [AdminSearchService],
  controllers: [AdminSearchController],
  exports: [AdminSearchService],
})
export class AdminSearchModule {}

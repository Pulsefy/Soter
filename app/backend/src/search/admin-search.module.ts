import { Module } from '@nestjs/common';
import { AdminSearchService } from './admin-search.service';
import { AdminSearchController } from './admin-search.controller';
import { SearchIndexService } from './search-index.service';
import { SearchIndexController } from './search-index.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [AdminSearchService, SearchIndexService],
  controllers: [AdminSearchController, SearchIndexController],
  exports: [AdminSearchService, SearchIndexService],
})
export class AdminSearchModule {}

import { Module, Global } from '@nestjs/common';
import { InternalNotesService } from './internal-notes.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../../audit/audit.module';

@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [InternalNotesService],
  exports: [InternalNotesService],
})
export class CommonServicesModule {}

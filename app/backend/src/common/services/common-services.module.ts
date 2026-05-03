import { Module, Global } from '@nestjs/common';
import { InternalNotesService } from './internal-notes.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../../audit/audit.module';
import { BudgetService } from '../budget/budget.service';

@Global()
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [InternalNotesService, BudgetService],
  exports: [InternalNotesService, BudgetService],
})
export class CommonServicesModule {}

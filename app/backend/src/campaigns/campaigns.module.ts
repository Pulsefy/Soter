import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { BudgetAlertsService } from './budget-alerts.service';
import { ClaimsModule } from '../claims/claims.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ClaimsModule, NotificationsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, BudgetAlertsService],
  exports: [BudgetAlertsService],
})
export class CampaignsModule {}

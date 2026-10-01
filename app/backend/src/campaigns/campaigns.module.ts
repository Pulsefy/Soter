import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignBudgetAlertScheduler } from './campaign-budget-alert.scheduler';
import { ClaimsModule } from '../claims/claims.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ClaimsModule, NotificationsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignBudgetAlertScheduler],
})
export class CampaignsModule {}

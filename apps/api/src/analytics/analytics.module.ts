import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}

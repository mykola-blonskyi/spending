import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { SyncController } from './sync.controller';
import { SyncScheduler, SyncService } from './sync.service';

@Module({
  imports: [WorkspacesModule, LedgerModule],
  controllers: [SyncController],
  providers: [SyncService, SyncScheduler],
})
export class SyncModule {}

import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { RecurringController } from './recurring.controller';
import { RecurringScheduler, RecurringService } from './recurring.service';

@Module({
  imports: [WorkspacesModule, LedgerModule, UsersModule],
  controllers: [RecurringController],
  providers: [RecurringService, RecurringScheduler],
})
export class RecurringModule {}

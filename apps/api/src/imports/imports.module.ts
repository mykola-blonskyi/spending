import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [WorkspacesModule, LedgerModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}

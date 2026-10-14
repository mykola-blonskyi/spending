import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { EcbRateSource, FX_RATE_SOURCE } from './fx/fx-source';
import { FxScheduler, FxService } from './fx/fx.service';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [LedgerController],
  providers: [
    LedgerService,
    FxService,
    FxScheduler,
    { provide: FX_RATE_SOURCE, useClass: EcbRateSource },
  ],
  exports: [LedgerService, FxService],
})
export class LedgerModule {}

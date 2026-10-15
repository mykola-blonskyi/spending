import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { BudgetsModule } from './budgets/budgets.module';
import { CsrfGuard, SessionGuard } from './auth/guards';
import { APP_CONFIG, type AppConfig } from './common/config';
import { ErrorFilter } from './common/error.filter';
import { rateLimitOptions } from './common/rate-limit';
import { DataRightsModule } from './data-rights/data-rights.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { ImportsModule } from './imports/imports.module';
import { LedgerModule } from './ledger/ledger.module';
import { RecurringModule } from './recurring/recurring.module';
import { SyncModule } from './sync/sync.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        DatabaseModule,
        ThrottlerModule.forRoot(rateLimitOptions),
        AuthModule,
        UsersModule,
        WorkspacesModule,
        LedgerModule,
        SyncModule,
        DataRightsModule,
        ImportsModule,
        BudgetsModule,
        RecurringModule,
        AnalyticsModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
        { provide: APP_FILTER, useClass: ErrorFilter },
        // Order matters: the throttler keys on the actor the session guard resolves.
        { provide: APP_GUARD, useExisting: SessionGuard },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: CsrfGuard },
      ],
      exports: [APP_CONFIG],
    };
  }
}

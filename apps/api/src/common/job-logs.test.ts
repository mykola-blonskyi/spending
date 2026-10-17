import { Logger } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from './config';
import type { Db } from '../database/database.module';
import { FxScheduler, type FxService } from '../ledger/fx/fx.service';
import { RecurringScheduler, RecurringService } from '../recurring/recurring.service';
import { SyncScheduler, type SyncService } from '../sync/sync.service';

const SECRET = 'Rent for flat 4B';
const queryError = () =>
  new DrizzleQueryError(
    'insert into "transactions" values ($1, $2)',
    [SECRET, 123456],
    Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }),
  );
const config = { env: 'production' } as AppConfig;

async function warnings(run: () => Promise<unknown>): Promise<string> {
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  await run();
  return warn.mock.calls.map((call) => String(call[0])).join('\n');
}

describe('background job failure logs', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [
      'fx_refresh_failed',
      () =>
        new FxScheduler(config, { refresh: () => Promise.reject(queryError()) } as FxService)[
          'run'
        ](),
    ],
    [
      'sync_prune_failed',
      () =>
        new SyncScheduler(config, {
          pruneMutations: () => Promise.reject(queryError()),
        } as unknown as SyncService)['run'](),
    ],
    [
      'recurring_run_failed',
      () =>
        new RecurringScheduler(config, {
          runDue: () => Promise.reject(queryError()),
        } as unknown as RecurringService)['run'](),
    ],
    [
      'recurring_rule_failed',
      () => {
        const db = {
          select: () => ({ from: () => ({ where: () => Promise.resolve([{ id: 'rule-1' }]) }) }),
        } as unknown as Db;
        const service = new RecurringService(db, never(), never(), never());
        vi.spyOn(
          service as unknown as { catchUp: () => Promise<never> },
          'catchUp',
        ).mockRejectedValue(queryError());
        return service.runDue(new Date());
      },
    ],
  ])('%s logs the database error code, never the bound parameters', async (event, run) => {
    const text = await warnings(run);
    expect(text).toContain(event);
    expect(text).toContain('55P03');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('123456');
  });
});

function never<T>(): T {
  return {} as T;
}

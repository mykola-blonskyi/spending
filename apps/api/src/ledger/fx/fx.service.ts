import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, between, eq, max, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../../common/config';
import { addDays } from '../../common/dates';
import { BASE_CURRENCY, type CurrencyCode } from '../../common/money';
import { DB, type Db, ledgerTransaction, type Tx } from '../../database/database.module';
import { fxRates, transactions } from '../../database/schema';
import {
  type Conversion,
  convert,
  RATE_LOOKBACK_DAYS,
  rateWindow,
  type RateQuote,
} from './conversion';
import type { FxRate } from './ecb';
import { FX_RATE_SOURCE, type FxFeed, fetchFeeds, type FxRateSource } from './fx-source';

const BACKFILL_BATCH = 500;
const UPSERT_BATCH = 1000;
/** Longer than a weekend plus a holiday, so normal ECB gaps never trigger a history fetch. */
const HISTORY_GAP_DAYS = 4;
/** The first day of the ECB series. Stored rates reaching it mean the full history is loaded. */
const ECB_FIRST_DAY = '1999-01-04';
/** The full history is about 30 MB, so even a failed attempt waits this long before the next. */
const FULL_HISTORY_INTERVAL_MS = 24 * 60 * 60_000;

@Injectable()
export class FxService {
  private readonly logger = new Logger('Fx');
  private lastFullHistoryAttempt = Number.NEGATIVE_INFINITY;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FX_RATE_SOURCE) private readonly source: FxRateSource,
  ) {}

  /** BR-14. Reads inside the caller's transaction, so a write converts with what it sees. */
  async conversion(
    tx: Tx,
    amountMinor: number,
    currency: CurrencyCode,
    occurredOn: string,
  ): Promise<Conversion> {
    return (await this.conversions(tx, amountMinor, currency, [occurredOn]))[0]!;
  }

  /** `conversion` of one amount on many dates, with one rate query for all of them. */
  async conversions(
    tx: Tx,
    amountMinor: number,
    currency: CurrencyCode,
    dates: readonly string[],
  ): Promise<Conversion[]> {
    const quotes = await this.quotes(tx, currency, dates);
    return dates.map((date) => convert(amountMinor, currency, quotes.get(date) ?? null));
  }

  /** BR-14 rate per date (the latest within 7 days before it), read with one query. */
  async quotes(
    tx: Tx,
    currency: CurrencyCode,
    dates: readonly string[],
  ): Promise<Map<string, RateQuote | null>> {
    const result = new Map<string, RateQuote | null>();
    if (currency === BASE_CURRENCY || dates.length === 0) return result;
    const sorted = [...dates].sort();
    const rates = await tx
      .select({ date: fxRates.date, ratePerEur: fxRates.ratePerEur, source: fxRates.source })
      .from(fxRates)
      .where(
        and(
          eq(fxRates.currency, currency),
          between(fxRates.date, rateWindow(sorted[0]!).from, sorted.at(-1)!),
        ),
      );
    const byDate = new Map(rates.map((rate) => [rate.date, rate]));
    for (const date of dates) {
      const { from, to } = rateWindow(date);
      let quote: RateQuote | null = null;
      for (let day = to; !quote && day >= from; day = addDays(day, -1)) {
        quote = byDate.get(day) ?? null;
      }
      result.set(date, quote);
    }
    return result;
  }

  /**
   * Fetches the latest rates, plus the 90-day history when the stored rates are missing or stale
   * (the API was down, or fetches failed), so missed days are recovered. When non-EUR rows predate
   * every stored rate (an old statement import), it also loads the full history once. A failed
   * feed is logged and skipped; rows are reconverted with whatever is stored.
   */
  async refresh(): Promise<{ rates: number; filled: number }> {
    const [stored] = await this.db.select({ latest: max(fxRates.date) }).from(fxRates);
    const stale =
      !stored?.latest ||
      stored.latest < addDays(new Date().toISOString().slice(0, 10), -HISTORY_GAP_DAYS);
    let rates = await this.store(await this.fetch(stale ? ['history', 'latest'] : ['latest']));
    if (
      Date.now() - this.lastFullHistoryAttempt >= FULL_HISTORY_INTERVAL_MS &&
      (await this.predatesStoredRates())
    ) {
      this.lastFullHistoryAttempt = Date.now();
      rates += await this.store(await this.fetch(['full']), 'keep');
    }
    return { rates, filled: await this.backfill() };
  }

  private fetch(feeds: readonly FxFeed[]): Promise<FxRate[]> {
    return fetchFeeds(this.source, feeds, (feed, error) =>
      this.logger.warn(
        `fx_feed_failed feed=${feed} ${error instanceof Error ? error.message : 'unknown'}`,
      ),
    );
  }

  /**
   * `fx_rates` is not a synced table, so a plain transaction suffices. `keep` leaves stored days
   * alone, so the full history never overrides what the daily feeds already gave.
   */
  private async store(rates: readonly FxRate[], existing: 'replace' | 'keep' = 'replace') {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < rates.length; i += UPSERT_BATCH) {
        const insert = tx
          .insert(fxRates)
          .values(
            rates.slice(i, i + UPSERT_BATCH).map((r) => ({ ...r, source: this.source.name })),
          );
        await (existing === 'keep'
          ? insert.onConflictDoNothing()
          : insert.onConflictDoUpdate({
              target: [fxRates.currency, fxRates.date],
              set: { ratePerEur: sql`excluded.rate_per_eur`, source: sql`excluded.source` },
            }));
      }
    });
    return rates.length;
  }

  /** True while an unconverted non-EUR row is older than every stored rate and older days exist. */
  private async predatesStoredRates(): Promise<boolean> {
    const { rows } = await this.db.execute<{ needed: boolean }>(sql`
      with oldest as (select min(date) as date from fx_rates)
      select exists (
        select 1 from transactions t, oldest
        where oldest.date > ${ECB_FIRST_DAY}::date
          and t.currency <> 'EUR' and t.deleted_at is null and t.base_amount_minor is null
          and t.occurred_on < oldest.date
      ) as needed`);
    return rows[0]?.needed === true;
  }

  /**
   * Converts rows saved before their rate existed, and moves rows converted with an earlier day's
   * rate onto a closer one once it is published (BR-14). Only derived columns change, so the
   * `transaction_version` trigger keeps `version` and no offline edit turns into a conflict.
   */
  async backfill(): Promise<number> {
    let filled = 0;
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const batch = await ledgerTransaction(this.db, async (tx) => {
        const { rows } = await tx.execute<{
          id: string;
          amount_minor: string;
          currency: string;
          date: string;
          rate_per_eur: string;
          source: string;
        }>(sql`
          select t.id, t.amount_minor, t.currency, r.date::text as date, r.rate_per_eur, r.source
          from transactions t
          cross join lateral (
            select date, rate_per_eur::text as rate_per_eur, source from fx_rates
            where currency = t.currency
              and date between t.occurred_on - ${RATE_LOOKBACK_DAYS}::int and t.occurred_on
            order by date desc limit 1
          ) r
          where t.currency <> 'EUR' and t.deleted_at is null
            and (t.fx_rate_date is null or t.fx_rate_date < r.date)
            and t.id > ${after}::uuid
          order by t.id
          limit ${BACKFILL_BATCH}
          for update of t`);
        for (const row of rows) {
          const conversion = convert(Number(row.amount_minor), row.currency as CurrencyCode, {
            date: row.date,
            ratePerEur: row.rate_per_eur,
            source: row.source,
          });
          if (conversion.baseAmountMinor === null) continue;
          await tx.update(transactions).set(conversion).where(eq(transactions.id, row.id));
          filled += 1;
        }
        return rows;
      });
      if (batch.length < BACKFILL_BATCH) return filled;
      after = batch.at(-1)!.id;
    }
  }
}

const STARTUP_DELAY_MS = 10_000;
const INTERVAL_MS = 6 * 60 * 60_000;

/** Refreshes rates shortly after startup and every 6 hours. Off in tests, which call refresh. */
@Injectable()
export class FxScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Fx');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.env === 'test') return;
    this.timers = [
      setTimeout(() => void this.run(), STARTUP_DELAY_MS).unref(),
      setInterval(() => void this.run(), INTERVAL_MS).unref(),
    ];
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers) clearTimeout(timer);
  }

  private async run(): Promise<void> {
    try {
      const { rates, filled } = await this.fx.refresh();
      this.logger.log(`fx_refreshed rates=${rates} filled=${filled}`);
    } catch (error) {
      this.logger.warn(`fx_refresh_failed ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
}

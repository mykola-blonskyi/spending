import { Inject, Injectable } from '@nestjs/common';
import { and, between, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB, type Db } from '../database/database.module';
import { categories, transactions } from '../database/schema';
import { AccessPolicy } from '../workspaces/access-policy';
import {
  byCategoryOf,
  type CategoryInfo,
  granularityOf,
  type Period,
  previousPeriod,
  seriesOf,
  type Summary,
  type SummaryQuery,
  type SumRow,
  totalsOf,
  unconvertedOf,
} from './summary';

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AccessPolicy) private readonly policy: AccessPolicy,
  ) {}

  /** Confirmed, live rows of the actor's workspaces in the scope only (BR-2, BR-16, BR-21). */
  async summary(actorId: string, query: SummaryQuery): Promise<Summary> {
    const workspaceIds = (await this.policy.memberships(actorId))
      .filter((m) => query.scope === 'all' || m.kind === query.scope)
      .map((m) => m.workspaceId);
    const period = { from: query.from, to: query.to };
    const rows = await this.sums(workspaceIds, period);
    const before = query.compare === 'previous' ? previousPeriod(period) : null;
    const previousRows = before ? await this.sums(workspaceIds, before) : [];
    const info = await this.categories([...rows, ...previousRows]);
    const totals = totalsOf(rows);
    const granularity = granularityOf(period);
    const summary: Summary = {
      period,
      granularity,
      totals,
      unconverted: unconvertedOf(rows),
      byCategory: byCategoryOf(rows, info),
      series: seriesOf(rows, period, granularity),
    };
    if (before) {
      const previous = totalsOf(previousRows);
      summary.previous = {
        period: before,
        totals: previous,
        byCategory: byCategoryOf(previousRows, info),
        deltas: {
          incomeMinor: totals.incomeMinor - previous.incomeMinor,
          expenseMinor: totals.expenseMinor - previous.expenseMinor,
          balanceMinor: totals.balanceMinor - previous.balanceMinor,
        },
      };
    }
    return summary;
  }

  /** Only server rows exist here, so an open conflict never counts twice (BR-19). */
  private async sums(workspaceIds: string[], period: Period): Promise<SumRow[]> {
    if (workspaceIds.length === 0) return [];
    const rows = await this.db
      .select({
        occurredOn: transactions.occurredOn,
        kind: transactions.kind,
        categoryId: transactions.categoryId,
        currency: transactions.currency,
        converted: sql<string | null>`sum(${transactions.baseAmountMinor})`,
        unconverted: sql<
          string | null
        >`sum(${transactions.amountMinor}) filter (where ${transactions.baseAmountMinor} is null)`,
      })
      .from(transactions)
      .where(
        and(
          inArray(transactions.workspaceId, workspaceIds),
          eq(transactions.reviewStatus, 'confirmed'),
          isNull(transactions.deletedAt),
          between(transactions.occurredOn, period.from, period.to),
        ),
      )
      .groupBy(
        transactions.occurredOn,
        transactions.kind,
        transactions.categoryId,
        transactions.currency,
      );
    return rows.map(({ converted, unconverted, ...row }) => ({
      ...row,
      convertedMinor: Number(converted ?? 0),
      unconvertedMinor: Number(unconverted ?? 0),
    }));
  }

  private async categories(rows: readonly SumRow[]): Promise<Map<string, CategoryInfo>> {
    const ids = [...new Set(rows.flatMap((row) => (row.categoryId ? [row.categoryId] : [])))];
    if (ids.length === 0) return new Map();
    const found = await this.db
      .select({
        id: categories.id,
        name: categories.name,
        systemKey: categories.systemKey,
        color: categories.color,
      })
      .from(categories)
      .where(inArray(categories.id, ids));
    return new Map(found.map(({ id, ...info }) => [id, info]));
  }
}

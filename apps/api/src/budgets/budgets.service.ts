import { Inject, Injectable } from '@nestjs/common';
import { and, asc, between, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../common/errors';
import { DB, type Db, type Tx } from '../database/database.module';
import { budgets, categories, transactions } from '../database/schema';
import { UsersService } from '../users/users.service';
import { AccessPolicy } from '../workspaces/access-policy';
import type { WorkspaceKind } from '../workspaces/family';
import {
  type BudgetQuery,
  type BudgetView,
  type CurrencySum,
  monthIn,
  monthRange,
  progress,
  type PutBudget,
} from './progress';

type BudgetRow = Readonly<{
  id: string;
  workspaceId: string;
  categoryId: string;
  amountMinor: number;
}>;

const budgetColumns = {
  id: budgets.id,
  workspaceId: budgets.workspaceId,
  categoryId: budgets.categoryId,
  amountMinor: budgets.amountMinor,
};

@Injectable()
export class BudgetsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AccessPolicy) private readonly policy: AccessPolicy,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  /** Every budget of the visible workspaces (BR-2), with progress for `month` or the current one. */
  async list(actorId: string, query: BudgetQuery): Promise<BudgetView[]> {
    const kinds = await this.visibleKinds(actorId, query.workspaceId);
    const rows = await this.db
      .select(budgetColumns)
      .from(budgets)
      .where(inArray(budgets.workspaceId, [...kinds.keys()]))
      .orderBy(asc(budgets.createdAt), asc(budgets.id));
    return this.views(this.db, rows, kinds, query.month ?? (await this.currentMonth(actorId)));
  }

  /** Creates the category's budget or replaces its limit (BR-22). */
  async put(actorId: string, input: PutBudget): Promise<BudgetView> {
    const month = await this.currentMonth(actorId);
    return this.db.transaction(async (tx) => {
      const membership = await this.policy.requireMember(actorId, input.workspaceId, tx);
      const [category] = await tx
        .select({
          workspaceId: categories.workspaceId,
          kind: categories.kind,
          archivedAt: categories.archivedAt,
        })
        .from(categories)
        .where(eq(categories.id, input.categoryId));
      if (
        !category ||
        category.workspaceId !== input.workspaceId ||
        category.kind !== 'expense' ||
        category.archivedAt !== null
      ) {
        throw new ApiError('INVALID_CATEGORY');
      }
      const [row] = await tx
        .insert(budgets)
        .values(input)
        .onConflictDoUpdate({
          target: [budgets.workspaceId, budgets.categoryId],
          set: { amountMinor: input.amountMinor, updatedAt: sql`now()` },
        })
        .returning(budgetColumns);
      const [view] = await this.views(
        tx,
        [row!],
        new Map([[membership.workspaceId, membership.kind]]),
        month,
      );
      return view!;
    });
  }

  async remove(actorId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ workspaceId: budgets.workspaceId })
        .from(budgets)
        .where(eq(budgets.id, id));
      if (!row) throw new ApiError('NOT_FOUND');
      await this.policy.requireMember(actorId, row.workspaceId, tx);
      await tx.delete(budgets).where(eq(budgets.id, id));
    });
  }

  private async views(
    tx: Tx,
    rows: readonly BudgetRow[],
    kinds: ReadonlyMap<string, WorkspaceKind>,
    month: string,
  ): Promise<BudgetView[]> {
    if (rows.length === 0) return [];
    const { from, to } = monthRange(month);
    // Pending-review rows and tombstones never count (BR-16, BR-21); open conflicts change
    // nothing because only the server row exists here (BR-19).
    const sums = await tx
      .select({
        budgetId: budgets.id,
        currency: transactions.currency,
        converted: sql<string | null>`sum(${transactions.baseAmountMinor})`,
        unconverted: sql<
          string | null
        >`sum(${transactions.amountMinor}) filter (where ${transactions.baseAmountMinor} is null)`,
      })
      .from(budgets)
      .innerJoin(
        transactions,
        and(
          eq(transactions.workspaceId, budgets.workspaceId),
          eq(transactions.categoryId, budgets.categoryId),
        ),
      )
      .where(
        and(
          inArray(
            budgets.id,
            rows.map((row) => row.id),
          ),
          eq(transactions.kind, 'expense'),
          eq(transactions.reviewStatus, 'confirmed'),
          isNull(transactions.deletedAt),
          between(transactions.occurredOn, from, to),
        ),
      )
      .groupBy(budgets.id, transactions.currency);
    const byBudget = new Map<string, CurrencySum[]>();
    for (const sum of sums) {
      const list = byBudget.get(sum.budgetId) ?? [];
      list.push({
        currency: sum.currency,
        convertedMinor: Number(sum.converted ?? 0),
        unconvertedMinor: Number(sum.unconverted ?? 0),
      });
      byBudget.set(sum.budgetId, list);
    }
    return rows.map((row) => ({
      ...row,
      scope: kinds.get(row.workspaceId)!,
      month,
      ...progress(row.amountMinor, byBudget.get(row.id) ?? []),
    }));
  }

  private async visibleKinds(
    actorId: string,
    workspaceId: string | undefined,
  ): Promise<Map<string, WorkspaceKind>> {
    const memberships = workspaceId
      ? [await this.policy.requireMember(actorId, workspaceId)]
      : await this.policy.memberships(actorId);
    return new Map(memberships.map((m) => [m.workspaceId, m.kind]));
  }

  private async currentMonth(actorId: string): Promise<string> {
    return monthIn(new Date(), (await this.users.profile(actorId)).timezone);
  }
}

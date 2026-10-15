import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { addDays, todayIn } from '../common/dates';
import { ApiError } from '../common/errors';
import type { CurrencyCode } from '../common/money';
import { DB, type Db, ledgerTransaction, type Tx } from '../database/database.module';
import { accounts, categories, recurringRules, transactions, workspaces } from '../database/schema';
import { FxService } from '../ledger/fx/fx.service';
import { UsersService } from '../users/users.service';
import { AccessPolicy } from '../workspaces/access-policy';
import {
  type CreateRule,
  type RuleView,
  templateError,
  type TemplateFacts,
  type UpdateRule,
} from './rules';
import { nextOccurrence, occurrences } from './schedule';

type Rule = typeof recurringRules.$inferSelect;
type Generated = { inserted: number; more: boolean };

/** Occurrences per `generate` call, so a long backlog holds the ledger lock briefly (BR-33). */
const OCCURRENCE_LIMIT = 1000;

const later = (a: string, b: string | null) => (b !== null && b > a ? b : a);

@Injectable()
export class RecurringService {
  private readonly logger = new Logger('Recurring');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AccessPolicy) private readonly policy: AccessPolicy,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  async list(actorId: string, workspaceId?: string): Promise<RuleView[]> {
    const memberships = workspaceId
      ? [await this.policy.requireMember(actorId, workspaceId)]
      : await this.policy.memberships(actorId);
    const visible = new Set(memberships.map((m) => m.workspaceId));
    return this.views(this.db, visible, inArray(recurringRules.workspaceId, [...visible]));
  }

  async create(actorId: string, input: CreateRule): Promise<RuleView> {
    const timezone = input.timezone ?? (await this.users.profile(actorId)).timezone;
    return ledgerTransaction(this.db, async (tx) => {
      await this.policy.requireMember(actorId, input.workspaceId, tx);
      await this.checkTemplate(tx, actorId, { ...input, createdBy: actorId }, null);
      const [rule] = await tx
        .insert(recurringRules)
        .values({
          ...input,
          timezone,
          createdBy: actorId,
          nextOccurrence: nextOccurrence(input, input.startsOn),
        })
        .returning();
      await this.generate(tx, rule!, new Date());
      return this.view(tx, actorId, rule!.id);
    });
  }

  /**
   * BR-24: occurrences already due are generated with the old template first, then the next
   * occurrence is recomputed from max(today, the current next), so the edit reaches only the future.
   */
  async update(actorId: string, id: string, patch: UpdateRule): Promise<RuleView> {
    await this.load(this.db, actorId, id);
    // A backlog longer than one call is committed call by call first, still with the old template.
    while ((await this.catchUp(id, new Date())).more);
    return ledgerTransaction(this.db, async (tx) => {
      await this.generate(tx, await this.load(tx, actorId, id), new Date());
      const current = await this.load(tx, actorId, id);
      const { paused, ...fields } = patch;
      const accountHidden =
        current.accountId !== null && !(await this.accountVisible(tx, actorId, current.accountId));
      // BR-3: a member who cannot see the creator's account receives null and keeps it by sending null.
      if (fields.accountId === null && accountHidden) delete fields.accountId;
      const merged = { ...current, ...fields };
      if (merged.endsOn !== null && merged.endsOn < merged.startsOn) {
        throw new ApiError('VALIDATION_FAILED', 'endsOn must not be before startsOn');
      }
      await this.checkTemplate(tx, actorId, merged, current);
      const today = todayIn(new Date(), merged.timezone);
      const [rule] = await tx
        .update(recurringRules)
        .set({
          ...fields,
          ...(paused === undefined
            ? {}
            : { pausedAt: paused ? sql`coalesce(${recurringRules.pausedAt}, now())` : null }),
          nextOccurrence: nextOccurrence(merged, later(today, current.nextOccurrence ?? today)),
          updatedAt: sql`now()`,
        })
        .where(eq(recurringRules.id, id))
        .returning();
      await this.generate(tx, rule!, new Date());
      return this.view(tx, actorId, id);
    });
  }

  /** BR-24: generated transactions stay; their rule reference becomes null. */
  async remove(actorId: string, id: string): Promise<void> {
    await ledgerTransaction(this.db, async (tx) => {
      await this.load(tx, actorId, id);
      await tx.delete(recurringRules).where(eq(recurringRules.id, id));
    });
  }

  /**
   * Generates due occurrences of every active rule, catching up after downtime (BR-23); a backlog
   * past `OCCURRENCE_LIMIT` completes over later runs (BR-33). Each rule commits on its own under
   * the ledger lock and re-reads its next occurrence there, and the unique (rule, occurrence) key
   * makes inserts no-ops, so concurrent or repeated runs add nothing.
   */
  async runDue(now: Date): Promise<number> {
    const candidates = await this.db
      .select({ id: recurringRules.id })
      .from(recurringRules)
      // No zone is more than a day ahead of UTC, so later rules cannot be due anywhere yet.
      .where(
        and(
          isNull(recurringRules.pausedAt),
          lte(recurringRules.nextOccurrence, addDays(todayIn(now, 'UTC'), 1)),
        ),
      );
    let generated = 0;
    for (const { id } of candidates) {
      try {
        generated += (await this.catchUp(id, now)).inserted;
      } catch (error) {
        this.logger.warn(
          `recurring_rule_failed id=${id} ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
    return generated;
  }

  private catchUp(id: string, now: Date): Promise<Generated> {
    return ledgerTransaction(this.db, async (tx) => {
      const [rule] = await tx
        .select()
        .from(recurringRules)
        .where(eq(recurringRules.id, id))
        .for('update');
      return rule ? this.generate(tx, rule, now) : { inserted: 0, more: false };
    });
  }

  /** Generates up to `OCCURRENCE_LIMIT` due occurrences; `more` says some are still due. */
  private async generate(tx: Tx, rule: Rule, now: Date): Promise<Generated> {
    const today = todayIn(now, rule.timezone);
    if (rule.pausedAt || !rule.nextOccurrence || rule.nextOccurrence > today) {
      return { inserted: 0, more: false };
    }
    const due = occurrences(rule, rule.nextOccurrence, today);
    const dates = due.slice(0, OCCURRENCE_LIMIT);
    const conversions = await this.fx.conversions(
      tx,
      rule.amountMinor,
      rule.currency as CurrencyCode,
      dates,
    );
    // A tombstoned occurrence keeps its row, so the conflict skips it too (BR-23).
    const rows = await tx
      .insert(transactions)
      .values(
        dates.map((occurredOn, i) => ({
          id: crypto.randomUUID(),
          workspaceId: rule.workspaceId,
          createdBy: rule.createdBy,
          kind: rule.kind,
          amountMinor: rule.amountMinor,
          currency: rule.currency,
          occurredOn,
          accountId: rule.accountId,
          categoryId: rule.categoryId,
          description: rule.description,
          source: 'recurring' as const,
          recurringRuleId: rule.id,
          recurringOccurrence: occurredOn,
          ...conversions[i]!,
        })),
      )
      .onConflictDoNothing({
        target: [transactions.recurringRuleId, transactions.recurringOccurrence],
        where: sql`${transactions.recurringRuleId} is not null`,
      })
      .returning({ id: transactions.id });
    const more = due.length > dates.length;
    await tx
      .update(recurringRules)
      .set({ nextOccurrence: more ? due[dates.length]! : nextOccurrence(rule, addDays(today, 1)) })
      .where(eq(recurringRules.id, rule.id));
    return { inserted: rows.length, more };
  }

  private async checkTemplate(
    tx: Tx,
    actorId: string,
    rule: Pick<Rule, 'workspaceId' | 'kind' | 'accountId' | 'categoryId' | 'createdBy'>,
    current: Rule | null,
  ): Promise<void> {
    const [account] = rule.accountId
      ? await tx
          .select({ workspaceId: accounts.workspaceId, archivedAt: accounts.archivedAt })
          .from(accounts)
          .where(eq(accounts.id, rule.accountId))
      : [];
    const [category] = rule.categoryId
      ? await tx
          .select({
            workspaceId: categories.workspaceId,
            kind: categories.kind,
            archivedAt: categories.archivedAt,
          })
          .from(categories)
          .where(eq(categories.id, rule.categoryId))
      : [];
    const facts: TemplateFacts = {
      ...rule,
      current,
      isCreator: rule.createdBy === actorId,
      creatorPersonalWorkspaceId: rule.createdBy
        ? await this.policy.personalWorkspaceId(rule.createdBy, tx)
        : null,
      account: account
        ? { workspaceId: account.workspaceId, archived: !!account.archivedAt }
        : null,
      category: category ? { ...category, archived: !!category.archivedAt } : null,
    };
    const error = templateError(facts);
    if (error) throw new ApiError(error);
  }

  /** The rule, after checking the actor is a member of its workspace (BR-1); else NOT_FOUND. */
  private async load(tx: Tx, actorId: string, id: string): Promise<Rule> {
    const [rule] = await tx
      .select()
      .from(recurringRules)
      .where(eq(recurringRules.id, id))
      .for('update');
    if (!rule) throw new ApiError('NOT_FOUND');
    await this.policy.requireMember(actorId, rule.workspaceId, tx);
    return rule;
  }

  private async accountVisible(tx: Tx, actorId: string, accountId: string): Promise<boolean> {
    const [account] = await tx
      .select({ workspaceId: accounts.workspaceId })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    const visible = (await this.policy.memberships(actorId, tx)).map((m) => m.workspaceId);
    return account !== undefined && visible.includes(account.workspaceId);
  }

  private async view(tx: Tx, actorId: string, id: string): Promise<RuleView> {
    const visible = new Set((await this.policy.memberships(actorId, tx)).map((m) => m.workspaceId));
    const [view] = await this.views(tx, visible, eq(recurringRules.id, id));
    return view!;
  }

  /** BR-3: an account outside the viewer's workspaces reads as null. */
  private async views(tx: Tx, visible: ReadonlySet<string>, where: SQL): Promise<RuleView[]> {
    const rows = await tx
      .select({
        rule: recurringRules,
        scope: workspaces.kind,
        accountWorkspaceId: accounts.workspaceId,
      })
      .from(recurringRules)
      .innerJoin(workspaces, eq(workspaces.id, recurringRules.workspaceId))
      .leftJoin(accounts, eq(accounts.id, recurringRules.accountId))
      .where(where)
      .orderBy(asc(recurringRules.createdAt), asc(recurringRules.id));
    return rows.map(({ rule, scope, accountWorkspaceId }) => ({
      id: rule.id,
      workspaceId: rule.workspaceId,
      scope,
      createdBy: rule.createdBy,
      kind: rule.kind,
      amountMinor: rule.amountMinor,
      currency: rule.currency,
      accountId: accountWorkspaceId && visible.has(accountWorkspaceId) ? rule.accountId : null,
      categoryId: rule.categoryId,
      description: rule.description,
      frequency: rule.frequency,
      interval: rule.interval,
      startsOn: rule.startsOn,
      endsOn: rule.endsOn,
      timezone: rule.timezone,
      nextOccurrence: rule.nextOccurrence,
      pausedAt: rule.pausedAt?.toISOString() ?? null,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    }));
  }
}

const STARTUP_DELAY_MS = 10_000;
const INTERVAL_MS = 15 * 60_000;

/** Generates due occurrences shortly after startup and every 15 minutes. Off in tests. */
@Injectable()
export class RecurringScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Recurring');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RecurringService) private readonly recurring: RecurringService,
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
      this.logger.log(`recurring_generated count=${await this.recurring.runDue(new Date())}`);
    } catch (error) {
      this.logger.warn(
        `recurring_run_failed ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}

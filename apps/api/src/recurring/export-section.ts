import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { exportSection } from '../data-rights/export-section';
import { accounts, frequencyEnum, recurringRules } from '../database/schema';
import { ENTRY_KINDS } from '../ledger/views';

const recurringRuleExportSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  createdBy: z.uuid().nullable(),
  kind: z.enum(ENTRY_KINDS),
  amountMinor: z.int(),
  currency: z.string(),
  accountId: z.uuid().nullable(),
  categoryId: z.uuid().nullable(),
  description: z.string(),
  frequency: z.enum(frequencyEnum.enumValues),
  interval: z.int(),
  startsOn: z.string(),
  endsOn: z.string().nullable(),
  timezone: z.string(),
  nextOccurrence: z.string().nullable(),
  pausedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** A family rule may use its author's personal account, which other members see as null (BR-3). */
export const recurringRulesExport = exportSection({
  schema: z.array(recurringRuleExportSchema),
  async read(tx, scope) {
    const rows = await tx
      .select({ rule: recurringRules, accountWorkspaceId: accounts.workspaceId })
      .from(recurringRules)
      .leftJoin(accounts, eq(accounts.id, recurringRules.accountId))
      .where(inArray(recurringRules.workspaceId, [...scope.visible]))
      .orderBy(recurringRules.createdAt, recurringRules.id);
    return rows.map(({ rule, accountWorkspaceId }) => ({
      ...rule,
      accountId:
        accountWorkspaceId !== null && scope.visible.has(accountWorkspaceId)
          ? rule.accountId
          : null,
      pausedAt: rule.pausedAt?.toISOString() ?? null,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    }));
  },
});

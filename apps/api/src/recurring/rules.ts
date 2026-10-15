import { z } from 'zod';
import type { ErrorCode } from '../common/errors';
import { calendarDateSchema, currencySchema, ENTRY_KINDS, type EntryKind } from '../ledger/views';
import { timezoneSchema } from '../users/profile';
import { WORKSPACE_KINDS } from '../workspaces/family';
import { FREQUENCIES } from './schedule';

const template = {
  kind: z.enum(ENTRY_KINDS),
  amountMinor: z.int().positive(),
  currency: currencySchema,
  accountId: z.uuid().nullable(),
  categoryId: z.uuid().nullable(),
  description: z.string().max(200),
  frequency: z.enum(FREQUENCIES),
  interval: z.int().min(1).max(366),
  startsOn: calendarDateSchema,
  // Named, because nestjs-zod renders a nullable top-level DTO property as an array.
  endsOn: calendarDateSchema.nullable().meta({ id: 'EndsOn' }),
  timezone: timezoneSchema,
};

const endsAfterStart = (rule: { startsOn?: string; endsOn?: string | null }) =>
  !rule.startsOn || !rule.endsOn || rule.endsOn >= rule.startsOn;
const endsOnIssue = { message: 'must not be before startsOn', path: ['endsOn'] };

export const createRuleSchema = z
  .strictObject({
    workspaceId: z.uuid(),
    ...template,
    accountId: template.accountId.default(null),
    categoryId: template.categoryId.default(null),
    description: template.description.default(''),
    interval: template.interval.default(1),
    endsOn: template.endsOn.default(null),
    timezone: template.timezone.optional(),
  })
  .refine(endsAfterStart, endsOnIssue);
export type CreateRule = z.infer<typeof createRuleSchema>;

export const updateRuleSchema = z
  .strictObject({ ...template, paused: z.boolean() })
  .partial()
  .refine(endsAfterStart, endsOnIssue);
export type UpdateRule = z.infer<typeof updateRuleSchema>;

// Named, because nestjs-zod renders a nullable top-level DTO property as an array.
const nullableId = z.uuid().nullable().meta({ id: 'NullableId' });
const nullableDate = z.string().nullable().meta({ id: 'NullableDate' });
const nullableTimestamp = z.iso.datetime().nullable().meta({ id: 'NullableTimestamp' });

export const ruleViewSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  scope: z.enum(WORKSPACE_KINDS),
  createdBy: nullableId,
  kind: z.enum(ENTRY_KINDS),
  amountMinor: z.int(),
  currency: z.string(),
  accountId: nullableId,
  categoryId: nullableId,
  description: z.string(),
  frequency: z.enum(FREQUENCIES),
  interval: z.int(),
  startsOn: z.string(),
  endsOn: nullableDate,
  timezone: z.string(),
  nextOccurrence: nullableDate,
  pausedAt: nullableTimestamp,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type RuleView = z.infer<typeof ruleViewSchema>;
export const ruleListSchema = z.object({ rules: z.array(ruleViewSchema) });

export type TemplateFacts = Readonly<{
  workspaceId: string;
  kind: EntryKind;
  accountId: string | null;
  categoryId: string | null;
  /** The rule's current references, which stay allowed even when archived. Null on create. */
  current: { accountId: string | null; categoryId: string | null } | null;
  isCreator: boolean;
  creatorPersonalWorkspaceId: string | null;
  account: { workspaceId: string; archived: boolean } | null;
  category: { workspaceId: string; kind: EntryKind; archived: boolean } | null;
}>;

/** The sync upsert's reference rules (BR-3, BR-4) applied to a rule's template. */
export function templateError(
  facts: TemplateFacts,
): Extract<ErrorCode, 'INVALID_ACCOUNT' | 'INVALID_CATEGORY'> | null {
  const { account, category } = facts;
  if (facts.accountId !== null) {
    const unchanged = facts.current?.accountId === facts.accountId;
    const allowed =
      account !== null &&
      (account.workspaceId === facts.workspaceId ||
        (account.workspaceId === facts.creatorPersonalWorkspaceId &&
          (facts.isCreator || unchanged)));
    if (!allowed || (account.archived && !unchanged)) return 'INVALID_ACCOUNT';
  }
  if (facts.categoryId !== null) {
    const unchanged = facts.current?.categoryId === facts.categoryId;
    if (
      category === null ||
      category.workspaceId !== facts.workspaceId ||
      category.kind !== facts.kind ||
      (category.archived && !unchanged)
    ) {
      return 'INVALID_CATEGORY';
    }
  }
  return null;
}

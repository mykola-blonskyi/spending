import { z } from 'zod';
import {
  amountMinorSchema,
  calendarDateSchema,
  currencySchema,
  ENTRY_KINDS,
} from '../ledger/views';
import { timezoneSchema } from '../users/profile';
import { WORKSPACE_KINDS } from '../workspaces/family';
import { FREQUENCIES } from './schedule';

const template = {
  kind: z.enum(ENTRY_KINDS),
  amountMinor: amountMinorSchema,
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

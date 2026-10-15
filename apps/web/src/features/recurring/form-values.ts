import { currencyExponent, minorToDecimalString, parseAmount } from '@shared/format';
import type { Rule, RuleInput } from './rules';

export type RuleFormValues = {
  kind: Rule['kind'];
  amount: string;
  currency: string;
  accountId: string | null;
  categoryId: string | null;
  description: string;
  frequency: Rule['frequency'];
  interval: string;
  startsOn: string;
  /** '' means the rule repeats without an end. */
  endsOn: string;
  timezone: string;
};

export type RuleFormErrors = Partial<Record<'amount' | 'interval' | 'endsOn', true>>;

export function valuesFromRule(rule: Rule): RuleFormValues {
  return {
    kind: rule.kind,
    amount: minorToDecimalString(rule.amountMinor, currencyExponent(rule.currency)),
    currency: rule.currency,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    description: rule.description,
    frequency: rule.frequency,
    interval: String(rule.interval),
    startsOn: rule.startsOn,
    endsOn: rule.endsOn ?? '',
    timezone: rule.timezone,
  };
}

export function ruleFromValues(
  values: RuleFormValues,
  workspaceId: string,
): { ok: true; input: RuleInput } | { ok: false; errors: RuleFormErrors } {
  const amountMinor = parseAmount(values.amount, currencyExponent(values.currency));
  const interval = /^\d+$/.test(values.interval.trim()) ? Number(values.interval) : 0;
  const endsOn = values.endsOn === '' ? null : values.endsOn;
  const errors: RuleFormErrors = {
    ...(amountMinor === null && { amount: true }),
    ...((interval < 1 || interval > 366) && { interval: true }),
    ...(endsOn !== null && endsOn < values.startsOn && { endsOn: true }),
  };
  if (amountMinor === null || Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      workspaceId,
      kind: values.kind,
      amountMinor,
      currency: values.currency,
      accountId: values.accountId,
      categoryId: values.categoryId,
      description: values.description.trim(),
      frequency: values.frequency,
      interval,
      startsOn: values.startsOn,
      endsOn,
      timezone: values.timezone,
    },
  };
}

import { describe, expect, it } from 'vitest';
import { type RuleFormValues, ruleFromValues, valuesFromRule } from './form-values';
import type { Rule } from './rules';

const values = (patch: Partial<RuleFormValues> = {}): RuleFormValues => ({
  kind: 'expense',
  amount: '50',
  currency: 'EUR',
  accountId: null,
  categoryId: 'cat',
  description: '  Rent ',
  frequency: 'monthly',
  interval: '1',
  startsOn: '2026-09-01',
  endsOn: '',
  timezone: 'Europe/Kyiv',
  ...patch,
});

describe('ruleFromValues', () => {
  it('builds the API input in minor units with no end date', () => {
    expect(ruleFromValues(values(), 'ws')).toEqual({
      ok: true,
      input: {
        workspaceId: 'ws',
        kind: 'expense',
        amountMinor: 5000,
        currency: 'EUR',
        accountId: null,
        categoryId: 'cat',
        description: 'Rent',
        frequency: 'monthly',
        interval: 1,
        startsOn: '2026-09-01',
        endsOn: null,
        timezone: 'Europe/Kyiv',
      },
    });
  });

  it('reports every invalid field at once', () => {
    expect(
      ruleFromValues(values({ amount: '0', interval: '1.5', endsOn: '2026-08-31' }), 'ws'),
    ).toEqual({ ok: false, errors: { amount: true, interval: true, endsOn: true } });
    expect(ruleFromValues(values({ interval: '367' }), 'ws')).toEqual({
      ok: false,
      errors: { interval: true },
    });
  });

  it('accepts an end on the start day', () => {
    expect(ruleFromValues(values({ endsOn: '2026-09-01' }), 'ws')).toMatchObject({
      ok: true,
      input: { endsOn: '2026-09-01' },
    });
  });
});

describe('valuesFromRule', () => {
  it('round-trips a rule through the form', () => {
    const rule = {
      kind: 'income',
      amountMinor: 123456,
      currency: 'JPY',
      accountId: 'acc',
      categoryId: null,
      description: 'Salary',
      frequency: 'weekly',
      interval: 2,
      startsOn: '2026-01-05',
      endsOn: '2026-12-28',
      timezone: 'Asia/Tokyo',
    } as Rule;
    const form = valuesFromRule(rule, '.');
    expect(form).toMatchObject({ amount: '123456', interval: '2', endsOn: '2026-12-28' });
    expect(ruleFromValues(form, 'ws')).toMatchObject({ ok: true, input: { amountMinor: 123456 } });
  });

  it('writes the amount with the locale decimal mark and reads it back', () => {
    const rule = {
      kind: 'expense',
      amountMinor: 1250,
      currency: 'EUR',
      accountId: null,
      categoryId: null,
      description: 'Gym',
      frequency: 'monthly',
      interval: 1,
      startsOn: '2026-01-05',
      endsOn: '',
      timezone: 'Europe/Madrid',
    } as unknown as Rule;
    const form = valuesFromRule(rule, ',');
    expect(form.amount).toBe('12,50');
    expect(ruleFromValues(form, 'ws')).toMatchObject({ ok: true, input: { amountMinor: 1250 } });
  });
});

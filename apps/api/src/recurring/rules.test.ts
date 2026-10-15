import { describe, expect, it } from 'vitest';
import { createRuleSchema, updateRuleSchema } from './rules';

describe('rule schemas', () => {
  it('caps amountMinor at 1e12 (BR-13)', () => {
    expect(updateRuleSchema.safeParse({ amountMinor: 1_000_000_000_000 }).success).toBe(true);
    expect(updateRuleSchema.safeParse({ amountMinor: 1_000_000_000_001 }).success).toBe(false);
    const rule = {
      workspaceId: 'a0000000-0000-4000-8000-000000000001',
      kind: 'expense',
      amountMinor: 1_000_000_000_001,
      currency: 'EUR',
      frequency: 'daily',
      startsOn: '2030-01-01',
    };
    expect(createRuleSchema.safeParse(rule).success).toBe(false);
    expect(createRuleSchema.safeParse({ ...rule, amountMinor: 1_000_000_000_000 }).success).toBe(
      true,
    );
  });
});

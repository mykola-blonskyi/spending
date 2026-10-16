import { describe, expect, it } from 'vitest';
import { parseAmount } from '@shared/format';
import { type FormValues, type KeypadKey, pressKey, validate, valuesFromDraft } from './form-model';

const values: FormValues = {
  kind: 'expense',
  amount: '12,50',
  currency: 'EUR',
  occurredOn: '2026-10-14',
  accountId: 'acc-1',
  categoryId: null,
  description: '  Coffee  ',
  note: ' oat milk ',
};

describe('validate', () => {
  it('builds trimmed draft fields when the amount parses', () => {
    expect(validate(values, 2)).toEqual({
      errors: {},
      draftFields: {
        kind: 'expense',
        amountMinor: 1250,
        currency: 'EUR',
        occurredOn: '2026-10-14',
        accountId: 'acc-1',
        categoryId: null,
        description: 'Coffee',
        note: 'oat milk',
      },
    });
  });

  it.each([[''], ['0'], ['1.234']])('has no draft for the amount %j', (amount) => {
    expect(validate({ ...values, amount }, 2)).toEqual({
      errors: { amount: 'invalid' },
      draftFields: null,
    });
  });

  it('judges precision by the currency exponent', () => {
    expect(validate({ ...values, amount: '12.5' }, 0).draftFields).toBeNull();
    expect(validate({ ...values, amount: '1.234' }, 3).draftFields?.amountMinor).toBe(1234);
  });
});

const press = (keys: KeypadKey[], exponent: number, start = '') =>
  keys.reduce((amount, key) => pressKey(amount, key, exponent), start);

describe('pressKey', () => {
  it('types an amount with a fraction up to the exponent', () => {
    expect(press(['1', '2', 'separator', '5', '0', '9'], 2)).toBe('12.50');
    expect(press(['1', 'separator', '2', '3', '4', '5'], 3)).toBe('1.234');
  });

  it('refuses the separator for a currency without minor units, and a second one', () => {
    expect(press(['5', 'separator', '0'], 0)).toBe('50');
    expect(press(['1', 'separator', 'separator', '5'], 2)).toBe('1.5');
  });

  it('starts a bare separator at zero and replaces a lone leading zero', () => {
    expect(press(['separator', '5'], 2)).toBe('0.5');
    expect(press(['0', '0', '7'], 2)).toBe('7');
  });

  it('continues an amount typed with a comma', () => {
    expect(press(['5', '5'], 2, '1,2')).toBe('1,25');
  });

  it('backspaces to empty and stays empty', () => {
    expect(
      press(['1', 'separator', '5', 'backspace', 'backspace', 'backspace', 'backspace'], 2),
    ).toBe('');
  });

  it.each([0, 2, 3])('caps the whole part at the BR-13 limit with exponent %i', (exponent) => {
    const amount = press(Array<KeypadKey>(20).fill('9'), exponent);
    expect(amount).toHaveLength(12 - exponent);
    expect(parseAmount(`${amount}.${'9'.repeat(exponent)}`, exponent)).not.toBeNull();
  });
});

describe('valuesFromDraft', () => {
  const draft = { ...values, amountMinor: 1250, workspaceId: 'ws-1' };

  it.each([
    ['.', '12.50'],
    [',', '12,50'],
  ])('writes the stored amount with the %s mark', (mark, amount) => {
    expect(valuesFromDraft(draft, mark).amount).toBe(amount);
    expect(parseAmount(amount, 2)).toBe(1250);
  });
});

import { describe, expect, it } from 'vitest';
import { parseAmount } from '@shared/format';
import {
  type EntryValues,
  type KeypadKey,
  pressKey,
  type TransferValues,
  validate,
  valuesFromDraft,
  withKind,
} from './form-model';

const values: EntryValues = {
  kind: 'expense',
  amount: '12,50',
  currency: 'EUR',
  occurredOn: '2026-10-14',
  accountId: 'acc-1',
  categoryId: null,
  description: '  Coffee  ',
  note: ' oat milk ',
};

const accounts = [
  { id: 'acc-1', workspaceId: 'ws-1', currency: 'EUR' },
  { id: 'acc-2', workspaceId: 'ws-1', currency: 'EUR' },
  { id: 'acc-uah', workspaceId: 'ws-1', currency: 'UAH' },
  { id: 'acc-jpy', workspaceId: 'ws-1', currency: 'JPY' },
  { id: 'acc-family', workspaceId: 'ws-2', currency: 'EUR' },
];

describe('validate', () => {
  it('builds trimmed draft fields when the amount parses', () => {
    expect(validate(values, accounts)).toEqual({
      errors: {},
      draft: {
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
    expect(validate({ ...values, amount }, accounts)).toEqual({
      errors: { amount: 'invalid' },
      draft: null,
    });
  });

  it('judges precision by the currency exponent', () => {
    expect(validate({ ...values, amount: '12.5', currency: 'JPY' }, accounts).draft).toBeNull();
    expect(validate({ ...values, amount: '1.234', currency: 'BHD' }, accounts).draft).toMatchObject(
      { amountMinor: 1234 },
    );
  });
});

describe('validate a transfer (BR-37)', () => {
  const transfer: TransferValues = {
    ...withKind(values, 'transfer'),
    kind: 'transfer',
    toAccountId: 'acc-2',
    received: '',
  };

  it('keeps what both kinds share and drops the category', () => {
    const switched = withKind({ ...values, categoryId: 'cat-1' }, 'transfer');
    expect(switched).toEqual({ ...transfer, toAccountId: null });
    expect(withKind(switched, 'income')).toEqual({ ...values, kind: 'income' });
  });

  it('sends and receives the same amount between accounts of one currency', () => {
    expect(validate({ ...transfer, received: '99' }, accounts)).toEqual({
      errors: {},
      draft: {
        kind: 'transfer',
        occurredOn: '2026-10-14',
        description: 'Coffee',
        note: 'oat milk',
        from: { accountId: 'acc-1', amountMinor: 1250, currency: 'EUR' },
        to: { accountId: 'acc-2', amountMinor: 1250, currency: 'EUR' },
      },
    });
  });

  it('stores what arrived across currencies, in the to-account exponent', () => {
    const cross = { ...transfer, toAccountId: 'acc-uah' };
    expect(validate({ ...cross, received: '540,25' }, accounts).draft).toMatchObject({
      from: { amountMinor: 1250, currency: 'EUR' },
      to: { accountId: 'acc-uah', amountMinor: 54_025, currency: 'UAH' },
    });
    expect(validate({ ...cross, received: '' }, accounts)).toEqual({
      errors: { received: 'invalid' },
      draft: null,
    });
    expect(
      validate({ ...transfer, toAccountId: 'acc-jpy', received: '1.5' }, accounts).errors,
    ).toEqual({ received: 'invalid' });
  });

  it.each([
    ['no to-account', { toAccountId: null }, 'required'],
    ['no from-account', { accountId: null }, 'required'],
    ['another workspace', { toAccountId: 'acc-family' }, 'required'],
    ['the same account', { toAccountId: 'acc-1' }, 'same'],
  ] as const)('needs two different accounts of one workspace: %s', (_, patch, error) => {
    expect(validate({ ...transfer, ...patch }, accounts)).toEqual({
      errors: { accounts: error },
      draft: null,
    });
  });

  it('needs a positive amount', () => {
    expect(validate({ ...transfer, amount: '0' }, accounts)).toEqual({
      errors: { amount: 'invalid' },
      draft: null,
    });
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
  const draft = {
    ...values,
    amountMinor: 1250,
    workspaceId: 'ws-1',
    transferId: null,
    transferOutside: false,
  };

  it.each([
    ['.', '12.50'],
    [',', '12,50'],
  ])('writes the stored amount with the %s mark', (mark, amount) => {
    expect(valuesFromDraft(draft, mark).amount).toBe(amount);
    expect(parseAmount(amount, 2)).toBe(1250);
  });
});

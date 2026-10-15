import type { TransactionDraft } from '@data/sync';
import { currencyExponent, minorToDecimalString } from '@shared/format';

const AMOUNT = /^(\d+)(?:[.,](\d*))?$/;

/** Parses what the user typed ("12", "12.5", "12,50") into positive minor units, or null. */
export function parseAmount(text: string, exponent: number): number | null {
  const match = AMOUNT.exec(text.trim().replace(/\s/g, ''));
  if (!match) return null;
  const [, whole = '', fraction = ''] = match;
  if (fraction.length > exponent) return null;
  const minor = Number(whole + fraction.padEnd(exponent, '0'));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

export type FormValues = {
  kind: 'income' | 'expense';
  amount: string;
  currency: string;
  occurredOn: string;
  accountId: string | null;
  categoryId: string | null;
  description: string;
};

export function valuesFromDraft(draft: TransactionDraft): FormValues {
  return {
    kind: draft.kind,
    amount: minorToDecimalString(draft.amountMinor, currencyExponent(draft.currency)),
    currency: draft.currency,
    occurredOn: draft.occurredOn,
    accountId: draft.accountId,
    categoryId: draft.categoryId,
    description: draft.description,
  };
}

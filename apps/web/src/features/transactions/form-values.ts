import type { TransactionDraft } from '@data/sync';
import { currencyExponent, minorToDecimalString } from '@shared/format';

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

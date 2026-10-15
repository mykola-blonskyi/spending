import type { TransactionDraft } from '@data/sync';
import {
  currencyExponent,
  MAX_AMOUNT_MINOR,
  minorToDecimalString,
  parseAmount,
} from '@shared/format';

export type EntryKind = TransactionDraft['kind'];

export type FormValues = Readonly<{
  kind: EntryKind;
  /** What the user typed or tapped, "12", "12.5" or "12,50"; parsed only on save. */
  amount: string;
  currency: string;
  occurredOn: string;
  accountId: string | null;
  categoryId: string | null;
  description: string;
  note: string;
}>;

export type FormErrors = Readonly<{ amount?: 'invalid' }>;

/** Everything a draft needs except the workspace, which the form's context decides. */
export type DraftFields = Omit<TransactionDraft, 'workspaceId'>;

/** A draft exists exactly when there are no errors. */
export function validate(
  values: FormValues,
  exponent: number,
): { errors: FormErrors; draftFields: DraftFields | null } {
  const amountMinor = parseAmount(values.amount, exponent);
  if (amountMinor === null) return { errors: { amount: 'invalid' }, draftFields: null };
  return {
    errors: {},
    draftFields: {
      kind: values.kind,
      amountMinor,
      currency: values.currency,
      occurredOn: values.occurredOn,
      accountId: values.accountId,
      categoryId: values.categoryId,
      description: values.description.trim(),
      note: values.note.trim(),
    },
  };
}

export function valuesFromDraft(draft: TransactionDraft): FormValues {
  return {
    kind: draft.kind,
    amount: minorToDecimalString(draft.amountMinor, currencyExponent(draft.currency)),
    currency: draft.currency,
    occurredOn: draft.occurredOn,
    accountId: draft.accountId,
    categoryId: draft.categoryId,
    description: draft.description,
    note: draft.note,
  };
}

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type KeypadKey = Digit | 'separator' | 'backspace';

export const KEYPAD_KEYS: readonly KeypadKey[] = [
  ...(['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const),
  'separator',
  '0',
  'backspace',
];

/** The keypad reducer: it refuses a key that would make the amount unparseable. */
export function pressKey(amount: string, key: KeypadKey, exponent: number): string {
  if (key === 'backspace') return amount.slice(0, -1);
  const [whole = '', fraction] = amount.split(/[.,]/);
  if (key === 'separator') {
    if (exponent === 0 || fraction !== undefined) return amount;
    return `${whole || '0'}.`;
  }
  if (fraction !== undefined) return fraction.length < exponent ? amount + key : amount;
  if (whole === '0') return key;
  // One digit short of the cap's, so every amount the keypad builds is within it (BR-13).
  return whole.length < String(MAX_AMOUNT_MINOR).length - 1 - exponent ? amount + key : amount;
}

/** The decimal mark this locale writes, for the keypad label and the shown amount. */
export function decimalSeparator(locale: string): string {
  return (
    new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === 'decimal')
      ?.value ?? '.'
  );
}

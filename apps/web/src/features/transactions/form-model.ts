import type { Account, TransactionDraft, TransferDraft } from '@data/sync';
import {
  currencyExponent,
  MAX_AMOUNT_MINOR,
  minorToDecimalString,
  parseAmount,
} from '@shared/format';

export type EntryKind = TransactionDraft['kind'];
/** A transfer exists only in the form; it is saved as an expense side and an income side (BR-37). */
export type FormKind = EntryKind | 'transfer';

type SharedValues = {
  /** What the user typed or tapped, "12", "12.5" or "12,50"; parsed only on save. */
  amount: string;
  currency: string;
  occurredOn: string;
  /** A transfer's from-account, whose currency `currency` follows. */
  accountId: string | null;
  description: string;
  note: string;
};

export type EntryValues = Readonly<SharedValues & { kind: EntryKind; categoryId: string | null }>;
export type TransferValues = Readonly<
  SharedValues & {
    kind: 'transfer';
    toAccountId: string | null;
    /** The amount that arrived, asked only when the two accounts' currencies differ. */
    received: string;
  }
>;
export type FormValues = EntryValues | TransferValues;
export type SharedKey = keyof SharedValues;

export type FormErrors = Readonly<{
  amount?: 'invalid';
  received?: 'invalid';
  accounts?: 'required' | 'same';
}>;

/** Everything a draft needs except the workspace and transfer mark, which the form keeps. */
type DraftFields = Omit<TransactionDraft, 'workspaceId' | 'transferId' | 'transferOutside'>;
export type FormDraft = DraftFields | ({ kind: 'transfer' } & Omit<TransferDraft, 'workspaceId'>);

type AccountRef = Pick<Account, 'id' | 'workspaceId' | 'currency'>;

/** Moves the typed values to another kind, keeping what both kinds share. */
export function withKind(values: FormValues, kind: FormKind): FormValues {
  const { amount, currency, occurredOn, accountId, description, note } = values;
  const shared = { amount, currency, occurredOn, accountId, description, note };
  if (kind === 'transfer') {
    return values.kind === 'transfer'
      ? values
      : { ...shared, kind, toAccountId: null, received: '' };
  }
  return { ...shared, kind, categoryId: values.kind === 'transfer' ? null : values.categoryId };
}

/** The other account of a transfer and the currency of what arrived when it differs. */
export function transferSides(
  values: FormValues,
  accounts: readonly AccountRef[],
): { from: AccountRef | undefined; to: AccountRef | undefined; receivedCurrency: string | null } {
  if (values.kind !== 'transfer') return { from: undefined, to: undefined, receivedCurrency: null };
  const from = accounts.find((account) => account.id === values.accountId);
  const to = accounts.find(
    (account) => account.id === values.toAccountId && account.workspaceId === from?.workspaceId,
  );
  const receivedCurrency = from && to && from.currency !== to.currency ? to.currency : null;
  return { from, to, receivedCurrency };
}

/**
 * A draft exists exactly when there are no errors. A transfer needs two different accounts of
 * one workspace (`accounts` are those the form offers) and, across currencies, what arrived.
 */
export function validate(
  values: FormValues,
  accounts: readonly AccountRef[],
): { errors: FormErrors; draft: FormDraft | null } {
  const description = values.description.trim();
  const note = values.note.trim();
  if (values.kind !== 'transfer') {
    const amountMinor = parseAmount(values.amount, currencyExponent(values.currency));
    if (amountMinor === null) return { errors: { amount: 'invalid' }, draft: null };
    const { kind, currency, occurredOn, accountId, categoryId } = values;
    return {
      errors: {},
      draft: { kind, amountMinor, currency, occurredOn, accountId, categoryId, description, note },
    };
  }
  const { from, to, receivedCurrency } = transferSides(values, accounts);
  const sent = parseAmount(values.amount, currencyExponent(from?.currency ?? values.currency));
  const received = receivedCurrency
    ? parseAmount(values.received, currencyExponent(receivedCurrency))
    : sent;
  const errors: FormErrors = {
    ...(sent === null && { amount: 'invalid' }),
    ...(receivedCurrency && received === null && { received: 'invalid' }),
    ...(!from || !to ? { accounts: 'required' } : from.id === to.id && { accounts: 'same' }),
  };
  if (!from || !to || sent === null || received === null || Object.keys(errors).length > 0) {
    return { errors, draft: null };
  }
  return {
    errors,
    draft: {
      kind: 'transfer',
      occurredOn: values.occurredOn,
      description,
      note,
      from: { accountId: from.id, amountMinor: sent, currency: from.currency },
      to: { accountId: to.id, amountMinor: received, currency: to.currency },
    },
  };
}

/** The stored entry as form values, its amount written with the locale's `separator`. */
export function valuesFromDraft(draft: TransactionDraft, separator: string): EntryValues {
  return {
    kind: draft.kind,
    amount: minorToDecimalString(draft.amountMinor, currencyExponent(draft.currency)).replace(
      '.',
      separator,
    ),
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

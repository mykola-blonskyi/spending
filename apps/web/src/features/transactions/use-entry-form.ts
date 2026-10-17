import { type FormEvent, useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  useAccounts,
  useDeleteTransaction,
  useDiscardChange,
  useLocalDataStatus,
  useLocalTransaction,
  useRecordTransaction,
  useUpdateTransaction,
  useWorkspaces,
} from '@data/sync';
import type { Scope } from '@features/family';
import { useCategoryViews } from '@features/ledger';
import { useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { COMMON_CURRENCIES, currencyExponent, decimalSeparator, todayIn } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import {
  type EntryKind,
  type FormValues,
  type KeypadKey,
  pressKey,
  validate,
  valuesFromDraft,
} from './form-model';
import { conversionOf } from './history-model';

export const HISTORY_PATH = '/transactions';

export type EntryStatus = 'loading' | 'unavailable' | 'notFound' | 'ready';

/** Leaves for history first, so the entry's screen never shows it gone or reverted. */
function useLeaveThen(write: (id: string) => Promise<void>): (id: string) => Promise<void> {
  const t = useTranslations('transactionForm');
  const navigate = useNavigate();
  return useCallback(
    async (id: string) => {
      void navigate(HISTORY_PATH);
      await write(id).catch(() => {
        toast.error(t('saveFailed'));
      });
    },
    [navigate, write, t],
  );
}

export const useRemoveEntry = () => useLeaveThen(useDeleteTransaction());
export const useDiscardEntry = () => useLeaveThen(useDiscardChange());

/**
 * One entry form, new or edit. Edit mode follows the route's `:id` unless `id` is given. Values
 * follow the stored entry until the user changes something. A save leaves for history unless
 * `onSaved` is given (a detail pane stays on its entry).
 */
export function useEntryForm(id?: string, onSaved?: () => void) {
  const t = useTranslations('transactionForm');
  const { locale } = useSharedLocale();
  const params = useParams();
  const entryId = id ?? params.id;
  const mode = entryId ? 'edit' : 'new';
  const navigate = useNavigate();
  const profile = useProfile();
  const localStatus = useLocalDataStatus();
  const stored = useLocalTransaction(entryId ?? '');
  const workspaces = useWorkspaces();
  const accounts = useAccounts();
  const categoryViews = useCategoryViews();
  const record = useRecordTransaction();
  const update = useUpdateTransaction();
  const removeEntry = useRemoveEntry();
  const discardEntry = useDiscardEntry();

  const [scope, setScope] = useState<Scope>('personal');
  const personal = workspaces.items.find((workspace) => workspace.kind === 'personal');
  const family = workspaces.items.find((workspace) => workspace.kind === 'family');
  const workspaceId =
    mode === 'edit'
      ? stored.entry?.workspaceId
      : (scope === 'family' && family ? family : personal)?.id;
  // Only the author may put a family entry on a personal account (BR-3). A row this device
  // created has no server author yet and is the signed-in user's own.
  const own = !stored.entry?.author || stored.entry.author.userId === profile.id;
  const status: EntryStatus =
    localStatus === 'unavailable'
      ? 'unavailable'
      : mode === 'edit' && stored.ready && !stored.entry
        ? 'notFound'
        : workspaceId
          ? 'ready'
          : 'loading';

  const transferId = stored.entry?.transferId ?? null;
  const today = todayIn(profile.timezone);
  const separator = decimalSeparator(locale);
  const initial = useMemo<FormValues>(
    () =>
      stored.entry
        ? valuesFromDraft(stored.entry, separator)
        : {
            kind: 'expense',
            amount: '',
            currency: 'EUR',
            occurredOn: today,
            accountId: null,
            categoryId: null,
            description: '',
            note: '',
          },
    [stored.entry, today, separator],
  );
  // Keyed by entry so a pane that switches entries never shows the previous one's edits. The
  // server version on screen when editing starts is the save's base, so a row pulled meanwhile
  // turns the save into a conflict instead of being overwritten (BR-19).
  const [edited, setEdited] = useState<{
    for: string;
    values: FormValues;
    version: number | null;
  } | null>(null);
  const key = entryId ?? 'new';
  const ours = edited && edited.for === key ? edited : null;
  // Editing began on a pending change: its base is the version that change becomes.
  const settledVersion = stored.entry?.version ?? null;
  if (ours && ours.version === null && settledVersion !== null) {
    setEdited({ ...ours, version: settledVersion });
  }
  const typed = ours ? ours.values : initial;
  const change = (patch: Partial<FormValues>) =>
    setEdited((current) =>
      current && current.for === key
        ? { ...current, values: { ...current.values, ...patch } }
        : { for: key, values: { ...initial, ...patch }, version: settledVersion },
    );

  // A transfer has no category (BR-37), so a transfer's form offers none.
  const categories = categoryViews.items.filter(
    (category) =>
      transferId === null &&
      category.workspaceId === workspaceId &&
      category.kind === typed.kind &&
      (!category.archived || category.id === typed.categoryId),
  );
  const workspaceAccounts = accounts.items.filter(
    (account) =>
      (account.workspaceId === workspaceId || (own && account.workspaceId === personal?.id)) &&
      (account.archivedAt === null || account.id === typed.accountId),
  );
  // A pick the current scope or kind no longer offers is dropped; everything else typed stays.
  const values: FormValues = {
    ...typed,
    accountId: workspaceAccounts.some((account) => account.id === typed.accountId)
      ? typed.accountId
      : null,
    categoryId: categories.some((category) => category.id === typed.categoryId)
      ? typed.categoryId
      : null,
  };

  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const exponent = currencyExponent(values.currency);
  const errors = attempted ? validate(values, exponent).errors : {};

  const currencies = [
    ...new Set([
      values.currency,
      ...workspaceAccounts.map((account) => account.currency),
      ...COMMON_CURRENCIES,
    ]),
  ].sort();

  // The stored conversion describes the stored amount and date (BR-14); an edit has none until saved.
  const conversion =
    stored.entry &&
    values.amount === initial.amount &&
    values.currency === initial.currency &&
    values.occurredOn === initial.occurredOn
      ? conversionOf(stored.entry)
      : null;

  return {
    status,
    mode,
    today,
    values,
    errors,
    set: <K extends keyof FormValues>(key: K, value: FormValues[K]) => change({ [key]: value }),
    setKind: (kind: EntryKind) => change({ kind }),
    scope,
    /** Family members choose where a new entry goes (BR-12). */
    scopeOffered: mode === 'new' && family !== undefined,
    setScope,
    setAccount: (accountId: string | null) => {
      const account = accounts.items.find((item) => item.id === accountId);
      change({ accountId: account?.id ?? null, ...(account && { currency: account.currency }) });
    },
    amount: {
      display: values.amount ? values.amount.replace(/[.,]/, separator) : '0',
      exponent,
      separator,
      press: (key: KeypadKey) => change({ amount: pressKey(values.amount, key, exponent) }),
    },
    conversion,
    isTransfer: transferId !== null,
    categories,
    accounts: workspaceAccounts,
    currencies,
    submitting,
    submit: async (event?: FormEvent) => {
      event?.preventDefault();
      setAttempted(true);
      const { draftFields } = validate(values, exponent);
      if (!draftFields || !workspaceId || submitting) return;
      setSubmitting(true);
      try {
        const draft = {
          ...draftFields,
          workspaceId,
          transferId,
          transferOutside: stored.entry?.transferOutside ?? false,
        };
        if (entryId) {
          await update(entryId, draft, ours?.version);
          // Later saves build on this one, whose base is now on the queue.
          setEdited((current) => current && { ...current, version: null });
        } else await record(draft);
        if (onSaved) onSaved();
        else await navigate(HISTORY_PATH);
      } catch {
        toast.error(t('saveFailed'));
      } finally {
        setSubmitting(false);
      }
    },
    entryId,
    canDelete: mode === 'edit' && status === 'ready',
    remove: () => (entryId ? removeEntry(entryId) : Promise.resolve()),
    canDiscard: status === 'ready' && stored.entry?.sync.state === 'failed',
    discard: () => (entryId ? discardEntry(entryId) : Promise.resolve()),
  };
}

export type EntryForm = ReturnType<typeof useEntryForm>;

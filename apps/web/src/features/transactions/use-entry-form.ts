import { type FormEvent, useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  useAccounts,
  useDeleteTransaction,
  useLocalDataStatus,
  useLocalTransaction,
  useRecordTransaction,
  useUpdateTransaction,
  useWorkspaces,
} from '@data/sync';
import { useCategoryViews } from '@features/ledger';
import { useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { currencyExponent, todayIn } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import {
  decimalSeparator,
  type EntryKind,
  type FormValues,
  type KeypadKey,
  pressKey,
  validate,
  valuesFromDraft,
} from './form-model';

export const HISTORY_PATH = '/transactions';
const COMMON_CURRENCIES = ['EUR', 'USD', 'GBP', 'UAH', 'PLN'];

export type EntryStatus = 'loading' | 'unavailable' | 'notFound' | 'ready';

/** Leaves for history first, so the deleted entry's screen never shows it gone. */
export function useRemoveEntry(): (id: string) => Promise<void> {
  const t = useTranslations('transactionForm');
  const navigate = useNavigate();
  const remove = useDeleteTransaction();
  return useCallback(
    async (id: string) => {
      void navigate(HISTORY_PATH);
      await remove(id).catch(() => {
        toast.error(t('saveFailed'));
      });
    },
    [navigate, remove, t],
  );
}

/**
 * One entry form, new or edit. Edit mode follows the route's `:id` unless `id` is given. Values
 * follow the stored entry until the user changes something.
 */
export function useEntryForm(id?: string) {
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

  const workspaceId =
    mode === 'edit'
      ? stored.entry?.workspaceId
      : workspaces.items.find((workspace) => workspace.kind === 'personal')?.id;
  const status: EntryStatus =
    localStatus === 'unavailable'
      ? 'unavailable'
      : mode === 'edit' && stored.ready && !stored.entry
        ? 'notFound'
        : workspaceId
          ? 'ready'
          : 'loading';

  const today = todayIn(profile.timezone);
  const initial = useMemo<FormValues>(
    () =>
      stored.entry
        ? valuesFromDraft(stored.entry)
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
    [stored.entry, today],
  );
  // Keyed by entry so a pane that switches entries never shows the previous one's edits.
  const [edited, setEdited] = useState<{ for: string; values: FormValues } | null>(null);
  const key = entryId ?? 'new';
  const values = edited && edited.for === key ? edited.values : initial;
  const change = (patch: Partial<FormValues>) =>
    setEdited((current) => ({
      for: key,
      values: { ...(current && current.for === key ? current.values : initial), ...patch },
    }));

  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const exponent = currencyExponent(values.currency);
  const errors = attempted ? validate(values, exponent).errors : {};

  const categories = categoryViews.items.filter(
    (category) =>
      category.workspaceId === workspaceId &&
      category.kind === values.kind &&
      (!category.archived || category.id === values.categoryId),
  );
  const workspaceAccounts = accounts.items.filter(
    (account) =>
      account.workspaceId === workspaceId &&
      (account.archivedAt === null || account.id === values.accountId),
  );
  const currencies = [
    ...new Set([
      values.currency,
      ...workspaceAccounts.map((account) => account.currency),
      ...COMMON_CURRENCIES,
    ]),
  ].sort();

  const separator = decimalSeparator(locale);

  return {
    status,
    mode,
    values,
    errors,
    set: <K extends keyof FormValues>(key: K, value: FormValues[K]) => change({ [key]: value }),
    setKind: (kind: EntryKind) => {
      const category = values.categoryId ? categoryViews.byId.get(values.categoryId) : undefined;
      change({ kind, categoryId: category?.kind === kind ? values.categoryId : null });
    },
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
        const draft = { ...draftFields, workspaceId };
        if (entryId) await update(entryId, draft);
        else await record(draft);
        await navigate(HISTORY_PATH);
      } catch {
        toast.error(t('saveFailed'));
      } finally {
        setSubmitting(false);
      }
    },
    canDelete: mode === 'edit' && status === 'ready',
    remove: () => (entryId ? removeEntry(entryId) : Promise.resolve()),
  };
}

export type EntryForm = ReturnType<typeof useEntryForm>;

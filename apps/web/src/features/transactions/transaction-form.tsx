import { useId, useMemo, useState } from 'react';
import type { Account, Category } from '@data/sync';
import { useTranslations } from '@i18n/index';
import { currencyExponent } from '@shared/format';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { type FormValues, parseAmount } from './form-values';

const NONE = 'none';
const COMMON_CURRENCIES = ['EUR', 'USD', 'GBP', 'UAH', 'PLN'];
const KINDS = ['expense', 'income'] as const;

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The fields of one entry. Workspace and note are carried by the caller. */
export function TransactionForm({
  initial,
  accounts,
  categories,
  onSubmit,
  footer,
}: {
  initial: FormValues;
  accounts: readonly Account[];
  categories: readonly Category[];
  onSubmit: (values: Omit<FormValues, 'amount'> & { amountMinor: number }) => Promise<void>;
  footer?: React.ReactNode;
}) {
  const t = useTranslations('transactionForm');
  const base = useId();
  const ids = {
    kind: `${base}-kind`,
    amount: `${base}-amount`,
    currency: `${base}-currency`,
    date: `${base}-date`,
    account: `${base}-account`,
    category: `${base}-category`,
    description: `${base}-description`,
  };
  const [values, setValues] = useState(initial);
  const [amountError, setAmountError] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<FormValues>) => setValues((current) => ({ ...current, ...patch }));

  const usableAccounts = accounts.filter((a) => !a.archivedAt || a.id === initial.accountId);
  const usableCategories = categories.filter(
    (c) => c.kind === values.kind && (!c.archivedAt || c.id === initial.categoryId),
  );
  // A pick the current scope or kind no longer offers is dropped; everything else typed stays.
  const accountId = usableAccounts.some((a) => a.id === values.accountId) ? values.accountId : null;
  const categoryId = usableCategories.some((c) => c.id === values.categoryId)
    ? values.categoryId
    : null;
  const currencies = useMemo(
    () =>
      [
        ...new Set([values.currency, ...accounts.map((a) => a.currency), ...COMMON_CURRENCIES]),
      ].sort(),
    [accounts, values.currency],
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const amountMinor = parseAmount(values.amount, currencyExponent(values.currency));
    setAmountError(amountMinor === null);
    if (amountMinor === null) return;
    setSaving(true);
    try {
      const { amount: _amount, ...rest } = values;
      await onSubmit({ ...rest, accountId, categoryId, amountMinor });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex max-w-xl flex-col gap-5"
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <Label id={ids.kind}>{t('kind')}</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          aria-labelledby={ids.kind}
          value={values.kind}
          onValueChange={(kind) => {
            if (kind === 'income' || kind === 'expense') set({ kind });
          }}
          className="w-full sm:w-auto"
        >
          {KINDS.map((kind) => (
            <ToggleGroupItem key={kind} value={kind} className="flex-1 px-4 sm:flex-none">
              {t(kind)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="grid gap-5 sm:grid-cols-[1fr_9rem]">
        <Field
          id={ids.amount}
          label={t('amount')}
          error={amountError ? t('amountInvalid') : undefined}
        >
          <Input
            id={ids.amount}
            inputMode="decimal"
            autoComplete="off"
            value={values.amount}
            aria-invalid={amountError || undefined}
            aria-describedby={amountError ? `${ids.amount}-error` : undefined}
            onChange={(event) => set({ amount: event.target.value })}
          />
        </Field>
        <Field id={ids.currency} label={t('currency')}>
          <Select value={values.currency} onValueChange={(currency) => set({ currency })}>
            <SelectTrigger id={ids.currency} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencies.map((currency) => (
                <SelectItem key={currency} value={currency}>
                  {currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field id={ids.date} label={t('date')}>
        <Input
          id={ids.date}
          type="date"
          required
          value={values.occurredOn}
          onChange={(event) => event.target.value && set({ occurredOn: event.target.value })}
        />
      </Field>

      <Field id={ids.account} label={t('account')}>
        <Select
          value={accountId ?? NONE}
          onValueChange={(value) => {
            const account = accounts.find((a) => a.id === value);
            set({ accountId: account?.id ?? null, ...(account && { currency: account.currency }) });
          }}
        >
          <SelectTrigger id={ids.account} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('noAccount')}</SelectItem>
            {usableAccounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field id={ids.category} label={t('category')}>
        <Select
          value={categoryId ?? NONE}
          onValueChange={(value) => set({ categoryId: value === NONE ? null : value })}
        >
          <SelectTrigger id={ids.category} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('noCategory')}</SelectItem>
            {usableCategories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field id={ids.description} label={t('description')}>
        <Input
          id={ids.description}
          maxLength={200}
          value={values.description}
          placeholder={t('descriptionPlaceholder')}
          onChange={(event) => set({ description: event.target.value })}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>
          {t('save')}
        </Button>
        {footer}
      </div>
    </form>
  );
}

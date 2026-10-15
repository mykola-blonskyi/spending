import { useId, useState } from 'react';
import { useAccounts, useCategories } from '@data/sync';
import { TimezoneSelect } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { useSharedLocale } from '@shared/lib/locale-context';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { type RuleFormErrors, type RuleFormValues, ruleFromValues } from './form-values';
import type { Rule, RuleInput } from './rules';

const NONE = 'none';
const COMMON_CURRENCIES = ['EUR', 'USD', 'GBP', 'UAH', 'PLN'];
const KINDS = ['expense', 'income'] as const;
const FREQUENCIES: readonly Rule['frequency'][] = ['daily', 'weekly', 'monthly', 'yearly'];

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, error: boolean | undefined, hint = false) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export function RuleForm({
  initial,
  workspaceId: initialWorkspaceId,
  scopes,
  submitLabel,
  onSubmit,
  footer,
}: {
  initial: RuleFormValues;
  workspaceId: string;
  scopes: { personal: string; family: string } | null;
  submitLabel: string;
  onSubmit: (input: RuleInput) => Promise<void>;
  footer?: React.ReactNode;
}) {
  const t = useTranslations();
  const { locale } = useSharedLocale();
  const base = useId();
  const ids = {
    scope: `${base}-scope`,
    kind: `${base}-kind`,
    amount: `${base}-amount`,
    currency: `${base}-currency`,
    account: `${base}-account`,
    category: `${base}-category`,
    description: `${base}-description`,
    frequency: `${base}-frequency`,
    interval: `${base}-interval`,
    intervalUnit: `${base}-interval-unit`,
    startsOn: `${base}-starts`,
    endsOn: `${base}-ends`,
    timezone: `${base}-timezone`,
  };
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<RuleFormErrors>({});
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<RuleFormValues>) =>
    setValues((current) => ({ ...current, ...patch }));

  const accounts = useAccounts().items.filter((a) => a.workspaceId === workspaceId);
  const categories = useCategories().items.filter((c) => c.workspaceId === workspaceId);
  const usableAccounts = accounts.filter((a) => !a.archivedAt || a.id === initial.accountId);
  const usableCategories = categories.filter(
    (c) => c.kind === values.kind && (!c.archivedAt || c.id === initial.categoryId),
  );
  const currencies = [
    ...new Set([values.currency, ...accounts.map((a) => a.currency), ...COMMON_CURRENCIES]),
  ].sort();
  const intervalCount = Number(values.interval) || 1;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = ruleFromValues(values, workspaceId);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await onSubmit(result.input);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex max-w-xl flex-col gap-8"
      noValidate
    >
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 text-lg font-semibold">{t('recurring.form.template')}</legend>

        {scopes && (
          <div className="flex flex-col gap-1.5">
            <Label id={ids.scope}>{t('recurring.form.scope')}</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              aria-labelledby={ids.scope}
              value={workspaceId}
              onValueChange={(value) => {
                if (!value || value === workspaceId) return;
                setWorkspaceId(value);
                set({ accountId: null, categoryId: null });
              }}
              className="w-full sm:w-auto"
            >
              <ToggleGroupItem value={scopes.personal} className="h-10 flex-1 px-4 sm:flex-none">
                {t('recurring.form.personal')}
              </ToggleGroupItem>
              <ToggleGroupItem value={scopes.family} className="h-10 flex-1 px-4 sm:flex-none">
                {t('recurring.form.family')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label id={ids.kind}>{t('transactionForm.kind')}</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            aria-labelledby={ids.kind}
            value={values.kind}
            onValueChange={(kind) => {
              if (kind !== 'income' && kind !== 'expense') return;
              const category = categories.find((c) => c.id === values.categoryId);
              set({ kind, categoryId: category?.kind === kind ? values.categoryId : null });
            }}
            className="w-full sm:w-auto"
          >
            {KINDS.map((kind) => (
              <ToggleGroupItem key={kind} value={kind} className="h-10 flex-1 px-4 sm:flex-none">
                {t(`transactionForm.${kind}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="grid gap-5 sm:grid-cols-[1fr_9rem]">
          <Field
            id={ids.amount}
            label={t('transactionForm.amount')}
            error={errors.amount ? t('transactionForm.amountInvalid') : undefined}
          >
            <Input
              id={ids.amount}
              inputMode="decimal"
              autoComplete="off"
              value={values.amount}
              aria-invalid={errors.amount}
              aria-describedby={describedBy(ids.amount, errors.amount)}
              onChange={(event) => set({ amount: event.target.value })}
            />
          </Field>
          <Field id={ids.currency} label={t('transactionForm.currency')}>
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

        <Field id={ids.account} label={t('transactionForm.account')}>
          <Select
            value={values.accountId ?? NONE}
            onValueChange={(value) => {
              const account = accounts.find((a) => a.id === value);
              set({
                accountId: account?.id ?? null,
                ...(account && { currency: account.currency }),
              });
            }}
          >
            <SelectTrigger id={ids.account} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('transactionForm.noAccount')}</SelectItem>
              {usableAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id={ids.category} label={t('transactionForm.category')}>
          <Select
            value={values.categoryId ?? NONE}
            onValueChange={(value) => set({ categoryId: value === NONE ? null : value })}
          >
            <SelectTrigger id={ids.category} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('transactionForm.noCategory')}</SelectItem>
              {usableCategories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field id={ids.description} label={t('transactionForm.description')}>
          <Input
            id={ids.description}
            maxLength={200}
            value={values.description}
            placeholder={t('transactionForm.descriptionPlaceholder')}
            onChange={(event) => set({ description: event.target.value })}
          />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-5">
        <legend className="mb-4 text-lg font-semibold">{t('recurring.form.schedule')}</legend>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={ids.frequency} label={t('recurring.form.frequency')}>
            <Select
              value={values.frequency}
              onValueChange={(frequency) => set({ frequency: frequency as Rule['frequency'] })}
            >
              <SelectTrigger id={ids.frequency} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((frequency) => (
                  <SelectItem key={frequency} value={frequency}>
                    {t(`recurring.form.${frequency}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex flex-col gap-1.5">
            <Label id={`${ids.interval}-label`} htmlFor={ids.interval}>
              {t('recurring.form.interval')}
            </Label>
            <div className="flex items-center gap-3">
              <Input
                id={ids.interval}
                type="number"
                inputMode="numeric"
                min={1}
                max={366}
                className="w-24"
                value={values.interval}
                aria-labelledby={`${ids.interval}-label ${ids.intervalUnit}`}
                aria-invalid={errors.interval}
                aria-describedby={describedBy(ids.interval, errors.interval)}
                onChange={(event) => set({ interval: event.target.value })}
              />
              <span id={ids.intervalUnit} className="text-sm">
                {t(`recurring.form.intervalUnit.${values.frequency}`, { count: intervalCount })}
              </span>
            </div>
            {errors.interval && (
              <p id={`${ids.interval}-error`} className="text-sm text-destructive">
                {t('recurring.form.intervalInvalid')}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={ids.startsOn} label={t('recurring.form.startsOn')}>
            <Input
              id={ids.startsOn}
              type="date"
              required
              value={values.startsOn}
              onChange={(event) => event.target.value && set({ startsOn: event.target.value })}
            />
          </Field>
          <Field
            id={ids.endsOn}
            label={t('recurring.form.endsOn')}
            hint={t('recurring.form.noEnd')}
            error={errors.endsOn ? t('recurring.form.endsBeforeStart') : undefined}
          >
            <Input
              id={ids.endsOn}
              type="date"
              value={values.endsOn}
              min={values.startsOn}
              aria-invalid={errors.endsOn}
              aria-describedby={describedBy(ids.endsOn, errors.endsOn, true)}
              onChange={(event) => set({ endsOn: event.target.value })}
            />
          </Field>
        </div>

        <Field
          id={ids.timezone}
          label={t('recurring.form.timezone')}
          hint={t('recurring.form.timezoneHint')}
        >
          <TimezoneSelect
            id={ids.timezone}
            value={values.timezone}
            locale={locale}
            onValueChange={(timezone) => set({ timezone })}
          />
        </Field>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={saving}>
          {submitLabel}
        </Button>
        {footer}
      </div>
    </form>
  );
}

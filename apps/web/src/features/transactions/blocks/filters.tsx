import { X } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslations } from '@i18n/index';
import { useIsDesktop } from '@shared/lib/media';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@shared/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import type { HistoryKind } from '../history-model';
import type { History } from '../use-history';

/** Radix Select cannot hold an empty value, so "any" stands in for the model's `''`. */
const ANY = 'any';
const control = 'h-11 w-full';

function AnySelect({
  id,
  value,
  anyLabel,
  options,
  onChange,
}: {
  id: string;
  value: string;
  anyLabel: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value || ANY} onValueChange={(next) => onChange(next === ANY ? '' : next)}>
      <SelectTrigger id={id} className={control}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{anyLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Every history filter but the search text, in a sheet opened by `trigger`. */
export function FilterSheet({ history, trigger }: { history: History; trigger: ReactNode }) {
  const t = useTranslations();
  const desktop = useIsDesktop();
  const base = useId();
  const ids = {
    kind: `${base}-kind`,
    from: `${base}-from`,
    to: `${base}-to`,
    category: `${base}-category`,
    account: `${base}-account`,
    currency: `${base}-currency`,
  };
  const { filters, setFilter, options } = history;

  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side={desktop ? 'right' : 'bottom'}
        className={cn(!desktop && 'max-h-[90dvh] rounded-t-2xl', 'overflow-y-auto')}
      >
        <SheetHeader>
          <SheetTitle>{t('history.filters')}</SheetTitle>
          <SheetDescription>{t('history.filtersDescription')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4">
          <div className="flex flex-col gap-1.5">
            <Label id={ids.kind}>{t('pages.transactions.kindFilter')}</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              aria-labelledby={ids.kind}
              value={filters.kind}
              onValueChange={(kind) => kind && setFilter('kind', kind as HistoryKind)}
              className="w-full"
            >
              {history.kindOptions.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value} className="h-11 flex-1">
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm leading-none font-medium">
              {t('history.period')}
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.from} className="text-xs text-muted-foreground">
                  {t('history.from')}
                </Label>
                <Input
                  id={ids.from}
                  type="date"
                  className="h-11"
                  value={filters.from}
                  max={filters.to || undefined}
                  onChange={(event) => setFilter('from', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.to} className="text-xs text-muted-foreground">
                  {t('history.to')}
                </Label>
                <Input
                  id={ids.to}
                  type="date"
                  className="h-11"
                  value={filters.to}
                  min={filters.from || undefined}
                  onChange={(event) => setFilter('to', event.target.value)}
                />
              </div>
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.category}>{t('transactionForm.category')}</Label>
            <AnySelect
              id={ids.category}
              value={filters.categoryId}
              anyLabel={t('history.anyCategory')}
              options={options.categories.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(value) => setFilter('categoryId', value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.account}>{t('transactionForm.account')}</Label>
            <AnySelect
              id={ids.account}
              value={filters.accountId}
              anyLabel={t('history.anyAccount')}
              options={options.accounts.map((a) => ({ value: a.id, label: a.name }))}
              onChange={(value) => setFilter('accountId', value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.currency}>{t('transactionForm.currency')}</Label>
            <AnySelect
              id={ids.currency}
              value={filters.currency}
              anyLabel={t('history.anyCurrency')}
              options={options.currencies.map((c) => ({ value: c, label: c }))}
              onChange={(value) => setFilter('currency', value)}
            />
          </div>
        </div>
        <SheetFooter className="flex-row gap-3">
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={history.reset}>
            {t('history.reset')}
          </Button>
          <SheetClose asChild>
            <Button type="button" className="h-11 flex-1">
              {t('history.done')}
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** The filters set in the sheet, each removable in one tap. */
export function ActiveChips({
  chips,
  className,
  chipClassName,
}: {
  chips: History['chips'];
  className?: string;
  chipClassName?: string;
}) {
  const t = useTranslations('history');
  if (chips.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-2', className)}>
      {chips.map((chip) => (
        <li key={chip.key}>
          <button
            type="button"
            onClick={chip.clear}
            aria-label={t('removeFilter', { label: chip.label })}
            className={cn(
              "relative flex h-8 items-center gap-1.5 rounded-full border bg-card pr-2 pl-3 text-[13px] font-medium transition-[background-color,transform] duration-150 ease-out outline-none before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/60 active:scale-[0.97]",
              chipClassName,
            )}
          >
            <span className="max-w-48 truncate">{chip.label}</span>
            <X aria-hidden className="size-3.5 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}

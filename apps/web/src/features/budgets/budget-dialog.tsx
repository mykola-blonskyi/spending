import { useId, useState } from 'react';
import { useWorkspaces } from '@data/sync';
import { useCategoryViews } from '@features/ledger';
import { useTranslations } from '@i18n/index';
import {
  currencyExponent,
  decimalSeparator,
  minorToDecimalString,
  parseAmount,
} from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@shared/ui/dialog';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { type Budget, budgetableCategories, usePutBudget } from './budgets';

/** BR-22: limits and progress are in EUR. */
export const BUDGET_CURRENCY = 'EUR';

export type BudgetDialogMode =
  { kind: 'create'; budgets: readonly Budget[] } | { kind: 'edit'; budget: Budget };

export function BudgetDialog({
  mode,
  trigger,
}: {
  mode: BudgetDialogMode;
  trigger: React.ReactNode;
}) {
  const t = useTranslations('budgets');
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(mode.kind === 'create' ? 'createTitle' : 'editTitle')}</DialogTitle>
          <DialogDescription>
            {t(mode.kind === 'create' ? 'createDescription' : 'editDescription')} {t('nearNote')}
          </DialogDescription>
        </DialogHeader>
        <BudgetForm mode={mode} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function BudgetForm({ mode, onDone }: { mode: BudgetDialogMode; onDone: () => void }) {
  const { locale } = useSharedLocale();
  const t = useTranslations();
  const base = useId();
  const workspaces = useWorkspaces().items;
  const categories = useCategoryViews().items;
  const put = usePutBudget();
  const editing = mode.kind === 'edit' ? mode.budget : null;
  const personal = workspaces.find((workspace) => workspace.kind === 'personal');
  const family = workspaces.find((workspace) => workspace.kind === 'family');

  const [workspaceId, setWorkspaceId] = useState(editing?.workspaceId ?? personal?.id ?? '');
  const choices =
    mode.kind === 'create' ? budgetableCategories(categories, workspaceId, mode.budgets) : [];
  const [chosenId, setChosenId] = useState<string | null>(null);
  const categoryId =
    editing?.categoryId ?? choices.find((c) => c.id === chosenId)?.id ?? choices[0]?.id;
  const [limit, setLimit] = useState(
    editing
      ? minorToDecimalString(editing.amountMinor, currencyExponent(BUDGET_CURRENCY)).replace(
          '.',
          decimalSeparator(locale),
        )
      : '',
  );
  const [limitError, setLimitError] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const amountMinor = parseAmount(limit, currencyExponent(BUDGET_CURRENCY));
    setLimitError(amountMinor === null);
    if (amountMinor === null || !categoryId) return;
    try {
      await put.mutateAsync({ workspaceId, categoryId, amountMinor });
      onDone();
    } catch {
      // usePutBudget already explained the failure; the dialog stays open to retry.
    }
  };

  const categoryName = editing && categories.find((c) => c.id === editing.categoryId)?.name;

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5" noValidate>
      {!editing && family && personal && (
        <div className="flex flex-col gap-1.5">
          <Label id={`${base}-scope`}>{t('budgets.scope')}</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            aria-labelledby={`${base}-scope`}
            value={workspaceId}
            onValueChange={(value) => value && setWorkspaceId(value)}
            className="w-full"
          >
            <ToggleGroupItem value={personal.id} className="h-10 flex-1">
              {t('budgets.personal')}
            </ToggleGroupItem>
            <ToggleGroupItem value={family.id} className="h-10 flex-1">
              {t('budgets.family')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      {editing ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm leading-none font-medium">{t('budgets.category')}</p>
          <p className="text-sm">{categoryName ?? t('pages.transactions.uncategorized')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${base}-category`}>{t('budgets.category')}</Label>
          {choices.length > 0 ? (
            <Select value={categoryId} onValueChange={setChosenId}>
              <SelectTrigger id={`${base}-category`} className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p id={`${base}-category`} className="text-sm text-muted-foreground">
              {t('budgets.allBudgeted')}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${base}-limit`}>{t('budgets.limit')}</Label>
        <Input
          id={`${base}-limit`}
          inputMode="decimal"
          autoComplete="off"
          className="h-10"
          value={limit}
          aria-invalid={limitError || undefined}
          aria-describedby={limitError ? `${base}-limit-error` : undefined}
          onChange={(event) => setLimit(event.target.value)}
        />
        {limitError && (
          <p id={`${base}-limit-error`} className="text-sm text-destructive">
            {t('budgets.limitInvalid')}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="submit" size="lg" disabled={put.isPending || !categoryId}>
          {t(editing ? 'budgets.edit' : 'budgets.add')}
        </Button>
      </DialogFooter>
    </form>
  );
}

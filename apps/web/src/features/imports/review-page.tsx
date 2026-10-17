import { ArrowLeftRight, ClipboardCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { errorCode } from '@data/api-error';
import type { ReviewItem } from '@data/imports';
import {
  type Category,
  type TransactionEntry,
  useAccounts,
  useLocalTransactions,
  useWorkspaces,
} from '@data/sync';
import { type CategoryView, useCategoryViews } from '@features/ledger';
import { useTranslations } from '@i18n/index';
import { EmptyState, ErrorState, LoadingState, MoneyText, PageHeader } from '@shared/components';
import { formatDate } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { useOnlineStatus } from '@shared/lib/network';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Checkbox } from '@shared/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { Toggle } from '@shared/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@shared/ui/toggle-group';
import { CategorySelect } from './category-select';
import { bankCategoryOf, useConfirmReview, useHasFamily, useReviewQueue } from './imports';
import { bulkCategoryChoice, type Choice, type Scope, transferChoice } from './review-choice';

const SCOPES: readonly Scope[] = ['personal', 'family'];
const ALL = {};

/** Null: an own account outside the app. */
type OtherSide = Pick<TransactionEntry, 'accountId' | 'occurredOn'> | null;

/** Checkbox, description, amount; scope and category beside them on wide screens, under them on phones. */
const ROW =
  'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_13rem]';
const WRAPPED = 'col-span-2 col-start-2 sm:col-span-1 sm:col-start-auto';

/** What each row would be published as: the server's suggestion until the user changes it. */
function defaultChoice(item: ReviewItem, scope: Scope): Choice {
  return {
    scope,
    categoryId: scope === 'family' ? item.familyCategoryId : item.transaction.categoryId,
  };
}

function ScopeToggle({
  value,
  onChange,
  label,
}: {
  value: Scope;
  onChange: (scope: Scope) => void;
  label: string;
}) {
  const t = useTranslations('imports.review');
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={label}
      value={value}
      onValueChange={(next) => SCOPES.includes(next as Scope) && onChange(next as Scope)}
    >
      {SCOPES.map((scope) => (
        <ToggleGroupItem key={scope} value={scope} className="px-3">
          {t(scope)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function ReviewPage() {
  const t = useTranslations();
  const { locale } = useSharedLocale();
  const online = useOnlineStatus();
  const hasFamily = useHasFamily();
  const queue = useReviewQueue();
  const workspaces = useWorkspaces();
  const categories = useCategoryViews();
  const confirm = useConfirmReview();
  const local = useLocalTransactions(ALL);
  const accounts = useAccounts();
  const [choices, setChoices] = useState<ReadonlyMap<string, Choice>>(new Map());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkScope, setBulkScope] = useState<Scope>('personal');

  const workspaceOf = useMemo(() => {
    const personal = workspaces.items.find((w) => w.kind === 'personal')?.id;
    const family = workspaces.items.find((w) => w.kind === 'family')?.id;
    return (scope: Scope) => (scope === 'family' ? family : personal);
  }, [workspaces.items]);
  const live = useMemo(() => categories.items.filter((c) => !c.archived), [categories.items]);
  const optionsFor = (scope: Scope, kind: Category['kind']) =>
    live.filter((c) => c.workspaceId === workspaceOf(scope) && c.kind === kind);

  const items = useMemo(() => queue.data ?? [], [queue.data]);
  const pending = useMemo(() => new Map(items.map((i) => [i.transaction.id, i])), [items]);
  /**
   * BR-38: the other side of each suggestion, a row of this queue or an entry on this device. A
   * suggestion whose other side is not here, or became a transfer meanwhile, is not offered.
   */
  const otherSides = useMemo(() => {
    const entries = new Map(local.items.map((entry) => [entry.id, entry]));
    return new Map(
      items.flatMap((item): [string, OtherSide][] => {
        const id = item.transferSuggestion?.counterpartId;
        if (id === undefined) return [];
        if (id === null) return [[item.transaction.id, null]];
        const other = pending.get(id)?.transaction ?? entries.get(id);
        return other && !other.transferId ? [[item.transaction.id, other]] : [];
      }),
    );
  }, [items, pending, local.items]);
  const accountName = (id: string | null) => accounts.items.find((a) => a.id === id)?.name ?? '';

  const choiceOf = (item: ReviewItem) =>
    choices.get(item.transaction.id) ?? defaultChoice(item, 'personal');
  const setChoice = (id: string, choice: Choice) =>
    setChoices((prev) => new Map(prev).set(id, choice));
  /** The other row of a transfer chosen between two rows of this queue; they publish together. */
  const partnerOf = (id: string) => {
    const counterpartId = choices.get(id)?.transfer?.counterpartId;
    return counterpartId && pending.has(counterpartId) ? counterpartId : null;
  };
  const withPartner = (id: string) => {
    const partner = partnerOf(id);
    return partner ? [id, partner] : [id];
  };
  const chosen = items.filter((i) => withPartner(i.transaction.id).some((id) => selected.has(id)));
  const chosenIds = new Set(chosen.map((i) => i.transaction.id));
  const allSelected = items.length > 0 && chosen.length === items.length;

  const setTransfer = (item: ReviewItem, on: boolean) => {
    const id = item.transaction.id;
    const counterpartId = item.transferSuggestion?.counterpartId ?? null;
    const partner = counterpartId ? pending.get(counterpartId) : undefined;
    setChoices((prev) => {
      const next = new Map(prev);
      next.set(id, on ? transferChoice(counterpartId) : defaultChoice(item, 'personal'));
      if (partner) {
        next.set(
          partner.transaction.id,
          on ? transferChoice(id) : defaultChoice(partner, 'personal'),
        );
      }
      return next;
    });
  };
  const applyScope = (scope: Scope) => {
    setBulkScope(scope);
    setChoices((prev) => {
      const next = new Map(prev);
      for (const item of chosen) {
        if (!choiceOf(item).transfer) next.set(item.transaction.id, defaultChoice(item, scope));
      }
      return next;
    });
  };
  /** The bulk scope is chosen first; the category comes from that workspace, per row kind. */
  const applyCategory = (category: CategoryView) => {
    setChoices((prev) => {
      const next = new Map(prev);
      for (const item of chosen) {
        const choice = bulkCategoryChoice(
          choiceOf(item),
          item.transaction.kind,
          bulkScope,
          category,
        );
        next.set(item.transaction.id, choice);
      }
      return next;
    });
  };
  const publish = () => {
    const body = chosen.map((item) => {
      const bankCategory = bankCategoryOf(item.transaction.id);
      return {
        transactionId: item.transaction.id,
        ...choiceOf(item),
        ...(bankCategory && { bankCategory }),
      };
    });
    confirm.mutate(body, {
      onSuccess: (published) => {
        toast.success(t('imports.review.confirmed', { count: published.length }));
        setSelected(new Set());
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('imports.review.title')} description={t('imports.review.description')} />
      {!workspaces.ready ? (
        <LoadingState rows={4} />
      ) : !hasFamily || (queue.isSuccess && items.length === 0) ? (
        <EmptyState
          icon={ClipboardCheck}
          title={t('imports.review.emptyTitle')}
          description={t('imports.review.emptyDescription')}
        />
      ) : queue.isPending ? (
        <LoadingState rows={4} />
      ) : queue.isError ? (
        <ErrorState
          title={t(`errors.${errorCode(queue.error)}`)}
          onRetry={() => void queue.refetch()}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3">
            <span className="text-sm font-medium">
              {t('imports.review.selected', { count: selected.size })}
            </span>
            <ScopeToggle
              value={bulkScope}
              onChange={applyScope}
              label={t('imports.review.bulkScope')}
            />
            <Select
              value=""
              onValueChange={(id) => {
                const category = live.find((c) => c.id === id);
                if (category) applyCategory(category);
              }}
            >
              <SelectTrigger aria-label={t('imports.review.bulkCategory')} className="min-w-48">
                <SelectValue placeholder={t('imports.review.bulkCategory')} />
              </SelectTrigger>
              <SelectContent>
                {(['expense', 'income'] as const).map((kind) => (
                  <SelectGroup key={kind}>
                    <SelectLabel>{t(`transactionForm.${kind}`)}</SelectLabel>
                    {optionsFor(bulkScope, kind).map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="ml-auto"
              disabled={chosen.length === 0 || confirm.isPending || !online}
              onClick={publish}
            >
              {confirm.isPending
                ? t('imports.review.confirming')
                : t('imports.review.confirm', { count: chosen.length })}
            </Button>
          </div>

          <div className="rounded-xl border">
            <div className={cn(ROW, 'py-2 text-xs font-medium text-muted-foreground')}>
              <Checkbox
                aria-label={t('imports.review.selectAll')}
                checked={allSelected}
                onCheckedChange={(checked) =>
                  setSelected(
                    checked === true ? new Set(items.map((i) => i.transaction.id)) : new Set(),
                  )
                }
              />
              <span>{t('transactionForm.description')}</span>
              <span className="justify-self-end">{t('transactionForm.amount')}</span>
              <span className="hidden sm:block">{t('imports.review.scope')}</span>
              <span className="hidden sm:block">{t('imports.review.category')}</span>
            </div>
            <ul aria-label={t('imports.review.title')} className="divide-y border-t">
              {items.map((item) => {
                const row = item.transaction;
                const choice = choiceOf(item);
                const otherSide = otherSides.get(row.id);
                return (
                  <li key={row.id} data-scope={choice.scope} className={ROW}>
                    <Checkbox
                      aria-label={t('imports.review.selectRow', { description: row.description })}
                      checked={chosenIds.has(row.id)}
                      onCheckedChange={(checked) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          for (const id of withPartner(row.id)) {
                            if (checked === true) next.add(id);
                            else next.delete(id);
                          }
                          return next;
                        })
                      }
                    />
                    <div className="min-w-0">
                      <span className="block truncate font-medium">{row.description}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(row.occurredOn, locale)}
                      </span>
                      {otherSide !== undefined && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <Toggle
                            variant="outline"
                            size="sm"
                            aria-label={`${t('transfer.label')}: ${row.description}`}
                            pressed={choice.transfer !== undefined}
                            onPressedChange={(on) => setTransfer(item, on)}
                          >
                            <ArrowLeftRight aria-hidden />
                            {t('transfer.label')}
                          </Toggle>
                          <span className="min-w-0 text-muted-foreground">
                            {t('imports.suggestions.title')}
                            {' · '}
                            {otherSide
                              ? t('imports.suggestions.otherSide', {
                                  account: accountName(otherSide.accountId),
                                  date: formatDate(otherSide.occurredOn, locale),
                                })
                              : t('transfer.outside')}
                          </span>
                        </div>
                      )}
                    </div>
                    <MoneyText
                      amountMinor={row.kind === 'expense' ? -row.amountMinor : row.amountMinor}
                      currency={row.currency}
                      colored
                      className="justify-self-end"
                    />
                    {choice.transfer ? (
                      <span className="col-span-2 col-start-2 text-xs text-muted-foreground sm:col-span-2 sm:col-start-auto">
                        {t('imports.review.transferChosen')}
                      </span>
                    ) : (
                      <>
                        <div className={WRAPPED}>
                          <ScopeToggle
                            value={choice.scope}
                            onChange={(scope) => setChoice(row.id, defaultChoice(item, scope))}
                            label={`${t('imports.review.scope')}: ${row.description}`}
                          />
                        </div>
                        <div className={WRAPPED}>
                          <CategorySelect
                            value={choice.categoryId}
                            categories={optionsFor(choice.scope, row.kind)}
                            onChange={(categoryId) => setChoice(row.id, { ...choice, categoryId })}
                            label={`${t('imports.review.category')}: ${row.description}`}
                            noneLabel={t('imports.review.noCategory')}
                            className="w-full"
                          />
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

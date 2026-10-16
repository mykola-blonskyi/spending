import { GitCompare, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorCode } from '@data/api-error';
import {
  type Conflict,
  type Resolution,
  type TransactionInput,
  useAccounts,
  useConflicts,
  useResolveConflict,
  useWorkspaces,
} from '@data/sync';
import { useCategoryViews } from '@features/ledger';
import { useTranslations } from '@i18n/index';
import { EmptyState, PageHeader } from '@shared/components';
import { formatDate, formatMoney } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Card } from '@shared/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@shared/ui/dialog';
import {
  CONFLICT_FIELDS,
  type ConflictField,
  differingFields,
  mergeVersions,
  pickSide,
  type Side,
  type Versions,
  versionsOf,
} from './conflict-model';

const SIDES: readonly Side[] = ['local', 'server'];

/** The sync center: open conflicts, each reviewed in a dialog. */
export function SyncPage() {
  const t = useTranslations();
  const conflicts = useConflicts();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('pages.sync.title')} description={t('pages.sync.description')} />
      {conflicts.items.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title={t('pages.sync.emptyTitle')}
          description={t('pages.sync.emptyDescription')}
        />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">
            {t('syncCenter.conflictsTitle')}
          </h2>
          <ul className="flex flex-col gap-2">
            {conflicts.items.map((conflict) => (
              <li key={conflict.id}>
                <ConflictCard conflict={conflict} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function summaryKey({ server, local }: Versions) {
  if (!server) return 'deletedOnServer' as const;
  if (!local) return 'deletedOnDevice' as const;
  return 'changedTwice' as const;
}

function ConflictCard({ conflict }: { conflict: Conflict }) {
  const t = useTranslations('syncCenter');
  const [open, setOpen] = useState(false);
  const versions = versionsOf(conflict);
  const name = versions.local?.description || versions.server?.description || t('untitled');
  return (
    <Card className="flex flex-row items-center gap-3 px-4 py-3">
      <GitCompare aria-hidden className="size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="text-xs text-muted-foreground">{t(summaryKey(versions))}</span>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" aria-label={t('reviewLabel', { name })}>
            {t('review')}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          {open && (
            <ConflictReview
              conflict={conflict}
              versions={versions}
              onResolved={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function useFieldText() {
  const t = useTranslations();
  const { locale } = useSharedLocale();
  const accounts = useAccounts().items;
  const categories = useCategoryViews().items;
  const workspaces = useWorkspaces().items;
  return (field: ConflictField, row: TransactionInput): string => {
    switch (field) {
      case 'kind':
        return t(`transactionForm.${row.kind}`);
      case 'amount':
        return formatMoney(row.amountMinor, row.currency, locale);
      case 'occurredOn':
        return formatDate(row.occurredOn, locale);
      case 'categoryId':
        return (
          categories.find((c) => c.id === row.categoryId)?.name ?? t('transactionForm.noCategory')
        );
      case 'accountId':
        return accounts.find((a) => a.id === row.accountId)?.name ?? t('transactionForm.noAccount');
      case 'workspaceId': {
        const kind = workspaces.find((w) => w.id === row.workspaceId)?.kind ?? 'personal';
        return t(`family.scope.${kind}`);
      }
      case 'description':
      case 'note':
        return row[field] || t('syncCenter.empty');
    }
  };
}

function useFieldLabel() {
  const t = useTranslations();
  return (field: ConflictField): string => {
    switch (field) {
      case 'occurredOn':
        return t('transactionForm.date');
      case 'categoryId':
        return t('transactionForm.category');
      case 'accountId':
        return t('transactionForm.account');
      case 'workspaceId':
        return t('family.scope.label');
      default:
        return t(`transactionForm.${field}`);
    }
  };
}

const rowGrid = 'grid grid-cols-[6.5rem_1fr_1fr] items-start gap-x-3 rounded-md px-2 py-1.5';

/**
 * Both versions side by side. Differing fields are highlighted and pickable; the description
 * names them, so a screen reader announces the differences when the dialog opens.
 */
function ConflictReview({
  conflict,
  versions,
  onResolved,
}: {
  conflict: Conflict;
  versions: Versions;
  onResolved: () => void;
}) {
  const t = useTranslations();
  const fieldText = useFieldText();
  const fieldLabel = useFieldLabel();
  const resolve = useResolveConflict();
  const [picks, setPicks] = useState<Partial<Record<ConflictField, Side>>>({});
  const [busy, setBusy] = useState(false);
  const differing = differingFields(versions);
  const { server, local } = versions;
  const sideLabel = (side: Side) => t(`syncCenter.${side}`);

  const submit = async (resolution: Resolution) => {
    setBusy(true);
    try {
      await resolve(conflict.id, resolution);
      toast.success(t('syncCenter.resolved'));
      onResolved();
    } catch (error) {
      toast.error(t(`errors.${errorCode(error)}`));
      setBusy(false);
    }
  };

  const description =
    server && local
      ? differing.length > 0
        ? t('syncCenter.differences', {
            count: differing.length,
            fields: differing.map(fieldLabel).join(', '),
          })
        : t('syncCenter.same')
      : t(`syncCenter.${summaryKey(versions)}`);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('syncCenter.reviewTitle')}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1 text-sm">
        <div aria-hidden className={cn(rowGrid, 'text-xs font-medium text-muted-foreground')}>
          <span />
          {SIDES.map((side) => (
            <span key={side}>{sideLabel(side)}</span>
          ))}
        </div>
        {CONFLICT_FIELDS.map((field) => {
          const label = fieldLabel(field);
          const value = (side: Side) => {
            const row = versions[side];
            return row ? fieldText(field, row) : t('syncCenter.deleted');
          };
          if (!differing.includes(field)) {
            return (
              <div key={field} className={rowGrid}>
                <span className="text-muted-foreground">{label}</span>
                {SIDES.map((side) => (
                  <span key={side} className="min-w-0 break-words">
                    <span className="sr-only">{sideLabel(side)}: </span>
                    {value(side)}
                  </span>
                ))}
              </div>
            );
          }
          const picked = picks[field] ?? 'server';
          return (
            <fieldset
              key={field}
              data-differs
              className={cn(rowGrid, 'border-l-2 border-warning bg-warning/10')}
            >
              <legend className="sr-only">{t('syncCenter.differs', { field: label })}</legend>
              <span aria-hidden className="font-medium">
                {label}
              </span>
              {SIDES.map((side) => (
                <label key={side} className="flex min-w-0 items-start gap-2">
                  <input
                    type="radio"
                    name={`${conflict.id}-${field}`}
                    value={side}
                    checked={picked === side}
                    onChange={() =>
                      setPicks((current) => pickSide(current, differing, field, side))
                    }
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 break-words">
                    <span className="sr-only">{sideLabel(side)}: </span>
                    {value(side)}
                  </span>
                </label>
              ))}
            </fieldset>
          );
        })}
      </div>
      <DialogFooter className="gap-2 sm:flex-wrap">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void submit({ resolution: 'server' })}
        >
          {t('syncCenter.keepServer')}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void submit({ resolution: 'local' })}
        >
          {t('syncCenter.keepLocal')}
        </Button>
        {server && local && differing.length > 0 && (
          <Button
            disabled={busy}
            onClick={() =>
              void submit({
                resolution: 'merged',
                transaction: mergeVersions(server, local, picks),
              })
            }
          >
            {t('syncCenter.keepMerged')}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

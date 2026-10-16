import { Plus, Tag } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { type Category, useCategories, useLocalDataStatus, useWorkspaces } from '@data/sync';
import { useTranslations } from '@i18n/index';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@shared/components';
import { useSharedLocale } from '@shared/lib/locale-context';
import { useOnlineStatus } from '@shared/lib/network';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { CATEGORY_ICON_NAMES, categoryIcon } from './category-icons';
import {
  type CategoryView,
  defaultCategoryName,
  findDuplicateCategory,
  useCategoryViews,
} from './category-view';
import { ArchivedGroup, Field, RowActions } from './ledger-parts';
import { useCategoriesAdmin } from './use-ledger-mutations';

type Kind = Category['kind'];
const KINDS: readonly Kind[] = ['expense', 'income'];
const SWATCHES = [
  '#16a34a',
  '#15803d',
  '#0d9488',
  '#0891b2',
  '#0284c7',
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#9333ea',
  '#db2777',
  '#e11d48',
  '#dc2626',
  '#ea580c',
  '#f59e0b',
  '#78716c',
  '#64748b',
];

const tint = (color: string) => `color-mix(in oklch, ${color} 15%, transparent)`;

function Swatch({ color, icon: Icon }: { color: string; icon: ReturnType<typeof categoryIcon> }) {
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: tint(color), color }}
    >
      <Icon className="size-5" strokeWidth={1.75} />
    </span>
  );
}

/** A group of native radios: arrow keys, focus and the checked state come from the browser. */
function RadioGrid<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
  className,
}: {
  name: string;
  label: string;
  value: string;
  options: readonly {
    value: T;
    label: string;
    content: React.ReactNode;
    style?: React.CSSProperties;
  }[];
  onChange: (value: T) => void;
  className: string;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className={className}>
        {options.map((option) => (
          <label
            key={option.value}
            title={option.label}
            className="relative flex size-11 cursor-pointer items-center justify-center rounded-lg border transition-transform duration-150 ease-out active:scale-[0.97] has-checked:border-primary has-checked:ring-2 has-checked:ring-primary/60 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/60"
            style={option.style}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              aria-label={option.label}
              onChange={() => onChange(option.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            {option.content}
          </label>
        ))}
      </div>
    </div>
  );
}

type Dialog = { category: Category } | 'new' | null;
type NameError = 'invalid' | { duplicate: string } | null;

function CategoryDialog({
  category,
  workspaceId,
  onClose,
  onShowExisting,
}: {
  category: Category | null;
  workspaceId: string;
  onClose: () => void;
  onShowExisting: (id: string) => void;
}) {
  const t = useTranslations('ledger');
  const actions = useTranslations('actions');
  const admin = useCategoriesAdmin();
  const views = useCategoryViews();
  const { locale } = useSharedLocale();
  const base = useId();
  const defaults = useTranslations('categoryDefaults');
  const defaultName = category?.systemKey
    ? defaultCategoryName(category.systemKey, defaults)
    : null;
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState<Kind>(category?.kind ?? 'expense');
  const [color, setColor] = useState(category?.color ?? SWATCHES[0] ?? '#16a34a');
  const [icon, setIcon] = useState(category?.icon ?? CATEGORY_ICON_NAMES[0] ?? 'tag');
  const [nameError, setNameError] = useState<NameError>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if ((trimmed.length < 1 && defaultName === null) || trimmed.length > 60) {
      setNameError('invalid');
      return;
    }
    const existing = findDuplicateCategory(
      views.items,
      {
        name: trimmed || (defaultName ?? ''),
        workspaceId: category?.workspaceId ?? workspaceId,
        kind: category?.kind ?? kind,
        exceptId: category?.id,
      },
      locale,
    );
    setNameError(existing ? { duplicate: existing.id } : null);
    if (existing) return;
    const saved = category
      ? await admin.update(category.id, { name: trimmed || null, color, icon })
      : await admin.create({ workspaceId, name: trimmed, kind, color, icon });
    if (saved) onClose();
  };

  const title = category ? t('categories.editTitle') : t('categories.createTitle');
  const customId = `${base}-custom`;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
          <Field
            id={`${base}-name`}
            label={t('name')}
            error={
              nameError === 'invalid'
                ? t('nameInvalid')
                : nameError
                  ? t('categories.duplicate')
                  : undefined
            }
            {...(category?.systemKey && { hint: t('categories.defaultHint') })}
          >
            <Input
              id={`${base}-name`}
              value={name}
              placeholder={defaultName ?? undefined}
              maxLength={60}
              autoComplete="off"
              aria-invalid={nameError !== null || undefined}
              aria-describedby={
                nameError
                  ? `${base}-name-error`
                  : category?.systemKey
                    ? `${base}-name-hint`
                    : undefined
              }
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {nameError !== null && nameError !== 'invalid' && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="-mt-3 h-auto self-start p-0"
              onClick={() => {
                onClose();
                onShowExisting(nameError.duplicate);
              }}
            >
              {t('categories.showExisting')}
            </Button>
          )}
          {!category && (
            <Field id={`${base}-kind`} label={t('categories.kind')}>
              <Select value={kind} onValueChange={(value) => setKind(value as Kind)}>
                <SelectTrigger id={`${base}-kind`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`categories.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="flex flex-col gap-3">
            <RadioGrid
              name={`${base}-color`}
              label={t('categories.color')}
              value={color}
              onChange={setColor}
              className="flex flex-wrap gap-2"
              options={SWATCHES.map((swatch) => ({
                value: swatch,
                label: swatch,
                style: { backgroundColor: swatch },
                content: null,
              }))}
            />
            <div className="flex items-center gap-3">
              <Label htmlFor={customId}>{t('categories.customColor')}</Label>
              <input
                id={customId}
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-11 w-14 cursor-pointer rounded-lg border bg-transparent p-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
              />
            </div>
          </div>
          <RadioGrid
            name={`${base}-icon`}
            label={t('categories.icon')}
            value={icon}
            onChange={setIcon}
            className="grid max-h-48 grid-cols-[repeat(auto-fill,2.75rem)] gap-2 overflow-y-auto p-1"
            options={CATEGORY_ICON_NAMES.map((iconName) => {
              const Icon = categoryIcon(iconName);
              return {
                value: iconName,
                label: iconName,
                content: (
                  <Icon aria-hidden className="size-5" style={{ color }} strokeWidth={1.75} />
                ),
              };
            })}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {actions('cancel')}
            </Button>
            <Button type="submit" disabled={admin.isPending} className="active:scale-[0.97]">
              {actions('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryRow({
  view,
  scope,
  disabled,
  highlighted,
  onEdit,
  onArchive,
  onRestore,
}: {
  view: CategoryView;
  scope: string | null;
  disabled: boolean;
  highlighted: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const item = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) item.current?.scrollIntoView?.({ block: 'center' });
  }, [highlighted]);
  return (
    <li
      ref={item}
      data-highlighted={highlighted || undefined}
      className={cn(
        'flex min-h-16 items-center gap-3 border-b py-2 transition-[background-color,box-shadow] duration-300 ease-out last:border-b-0',
        highlighted && 'rounded-lg bg-primary/5 ring-2 ring-primary/60',
      )}
    >
      <Swatch color={view.color} icon={view.Icon} />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate font-medium">{view.name}</span>
        {scope && <span className="shrink-0 text-sm text-muted-foreground">{scope}</span>}
      </div>
      <RowActions
        name={view.name}
        archived={view.archived}
        disabled={disabled}
        onEdit={onEdit}
        onArchive={onArchive}
        onRestore={onRestore}
      />
    </li>
  );
}

export function CategoriesPage() {
  const t = useTranslations('ledger');
  const pages = useTranslations('pages.categories');
  const states = useTranslations('states');
  const status = useLocalDataStatus();
  const online = useOnlineStatus();
  const categories = useCategories();
  const views = useCategoryViews();
  const workspaces = useWorkspaces();
  const admin = useCategoriesAdmin();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toArchive, setToArchive] = useState<CategoryView | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  useEffect(() => {
    if (highlightedId === null) return;
    const timer = setTimeout(() => setHighlightedId(null), 2500);
    return () => clearTimeout(timer);
  }, [highlightedId]);

  const stored = useMemo(() => new Map(categories.items.map((c) => [c.id, c])), [categories.items]);
  const personalId = workspaces.items.find((w) => w.kind === 'personal')?.id;
  const familyIds = new Set(workspaces.items.filter((w) => w.kind === 'family').map((w) => w.id));
  const blocked = !online;
  const add = (
    <Button
      disabled={blocked || !personalId}
      onClick={() => setDialog('new')}
      className="active:scale-[0.97]"
    >
      <Plus aria-hidden />
      {t('categories.add')}
    </Button>
  );
  const row = (view: CategoryView) => (
    <CategoryRow
      key={view.id}
      view={view}
      scope={familyIds.has(view.workspaceId) ? t('family') : null}
      disabled={blocked || admin.isPending}
      highlighted={view.id === highlightedId}
      onEdit={() => {
        const category = stored.get(view.id);
        if (category) setDialog({ category });
      }}
      onArchive={() => setToArchive(view)}
      onRestore={() => void admin.archive(view.id, false)}
    />
  );
  const section = (kind: Kind) => {
    const items = views.items.filter((v) => v.kind === kind);
    const live = items.filter((v) => !v.archived);
    return (
      <section key={kind} aria-labelledby={`categories-${kind}`} className="flex flex-col gap-3">
        <h2 id={`categories-${kind}`} className="text-lg font-semibold">
          {t(kind === 'expense' ? 'categories.expenseSection' : 'categories.incomeSection')}
        </h2>
        {live.length > 0 ? (
          <ul className="rounded-xl border bg-card px-4">{live.map(row)}</ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('categories.sectionEmpty')}</p>
        )}
      </section>
    );
  };

  let body: React.ReactNode;
  if (status === 'unavailable') {
    body = (
      <ErrorState
        title={states('error.title')}
        description={states('error.description')}
        onRetry={() => window.location.reload()}
      />
    );
  } else if (!views.ready) {
    body = <LoadingState />;
  } else if (views.items.length === 0) {
    body = (
      <EmptyState icon={Tag} title={pages('emptyTitle')} description={pages('emptyDescription')} />
    );
  } else {
    const archived = views.items.filter((v) => v.archived);
    body = (
      <div className="flex flex-col gap-8">
        {KINDS.map(section)}
        <ArchivedGroup
          count={archived.length}
          forceOpen={archived.some((v) => v.id === highlightedId)}
        >
          <ul className="rounded-xl border bg-card px-4">{archived.map(row)}</ul>
        </ArchivedGroup>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={pages('title')}
        description={pages('description')}
        actions={status === 'unavailable' ? undefined : add}
      />
      {blocked && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('offline')}
        </p>
      )}
      {body}
      {dialog && personalId && (
        <CategoryDialog
          category={dialog === 'new' ? null : dialog.category}
          workspaceId={personalId}
          onClose={() => setDialog(null)}
          onShowExisting={setHighlightedId}
        />
      )}
      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => !open && setToArchive(null)}
        title={t('categories.archiveTitle', { name: toArchive?.name ?? '' })}
        description={t('categories.archiveDescription')}
        confirmLabel={t('archive')}
        onConfirm={() => {
          if (toArchive) void admin.archive(toArchive.id, true);
          setToArchive(null);
        }}
      />
    </div>
  );
}

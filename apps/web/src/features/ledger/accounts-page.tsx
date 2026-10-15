import {
  Banknote,
  CreditCard,
  Landmark,
  type LucideIcon,
  PiggyBank,
  Plus,
  Wallet,
} from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { type Account, useAccounts, useLocalDataStatus, useWorkspaces } from '@data/sync';
import { useTranslations } from '@i18n/index';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@shared/components';
import { useOnlineStatus } from '@shared/lib/network';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { ArchivedGroup, Field, RowActions } from './ledger-parts';
import { useAccountsAdmin } from './use-ledger-mutations';

type Kind = Account['kind'];
const KINDS: readonly Kind[] = ['cash', 'bank', 'card', 'savings', 'other'];
const KIND_ICONS: Record<Kind, LucideIcon> = {
  cash: Banknote,
  bank: Landmark,
  card: CreditCard,
  savings: PiggyBank,
  other: Wallet,
};
const COMMON_CURRENCIES = [
  'EUR',
  'USD',
  'GBP',
  'UAH',
  'PLN',
  'CHF',
  'CZK',
  'SEK',
  'NOK',
  'DKK',
  'JPY',
  'CAD',
  'AUD',
];

type Dialog = { account: Account } | 'new' | null;

function AccountDialog({
  account,
  workspaces,
  currencies,
  onClose,
}: {
  account: Account | null;
  workspaces: readonly { id: string; label: string }[];
  currencies: readonly string[];
  onClose: () => void;
}) {
  const t = useTranslations('ledger');
  const actions = useTranslations('actions');
  const admin = useAccountsAdmin();
  const base = useId();
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<Kind>(account?.kind ?? 'bank');
  const [currency, setCurrency] = useState(account?.currency ?? currencies[0] ?? 'EUR');
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [nameError, setNameError] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    const invalid = trimmed.length < 1 || trimmed.length > 60;
    setNameError(invalid);
    if (invalid) return;
    const saved = account
      ? await admin.update(account.id, { name: trimmed, kind })
      : await admin.create({ workspaceId, name: trimmed, kind, currency });
    if (saved) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? t('accounts.editTitle') : t('accounts.createTitle')}</DialogTitle>
          <DialogDescription className="sr-only">
            {account ? t('accounts.editTitle') : t('accounts.createTitle')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
          <Field
            id={`${base}-name`}
            label={t('name')}
            error={nameError ? t('nameInvalid') : undefined}
          >
            <Input
              id={`${base}-name`}
              value={name}
              maxLength={60}
              autoComplete="off"
              aria-invalid={nameError || undefined}
              aria-describedby={nameError ? `${base}-name-error` : undefined}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field id={`${base}-kind`} label={t('accounts.kind')}>
            <Select value={kind} onValueChange={(value) => setKind(value as Kind)}>
              <SelectTrigger id={`${base}-kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`accounts.kinds.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            id={`${base}-currency`}
            label={t('accounts.currency')}
            {...(account && { hint: t('accounts.currencyLocked') })}
          >
            <Select value={currency} onValueChange={setCurrency} disabled={account !== null}>
              <SelectTrigger
                id={`${base}-currency`}
                className="w-full"
                {...(account && { 'aria-describedby': `${base}-currency-hint` })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {!account && workspaces.length > 1 && (
            <Field id={`${base}-workspace`} label={t('workspace')}>
              <Select value={workspaceId} onValueChange={setWorkspaceId}>
                <SelectTrigger id={`${base}-workspace`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
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

function AccountRow({
  account,
  scope,
  disabled,
  onEdit,
  onArchive,
  onRestore,
}: {
  account: Account;
  scope: string | null;
  disabled: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const t = useTranslations('ledger');
  const Icon = KIND_ICONS[account.kind];
  return (
    <li className="flex min-h-16 items-center gap-3 border-b py-2 last:border-b-0">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Icon aria-hidden className="size-5" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{account.name}</span>
        <span className="truncate text-sm text-muted-foreground">
          {[t(`accounts.kinds.${account.kind}`), account.currency, scope]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <RowActions
        name={account.name}
        archived={account.archivedAt !== null}
        disabled={disabled}
        onEdit={onEdit}
        onArchive={onArchive}
        onRestore={onRestore}
      />
    </li>
  );
}

export function AccountsPage() {
  const t = useTranslations('ledger');
  const pages = useTranslations('pages.accounts');
  const states = useTranslations('states');
  const status = useLocalDataStatus();
  const online = useOnlineStatus();
  const accounts = useAccounts();
  const workspaces = useWorkspaces();
  const admin = useAccountsAdmin();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toArchive, setToArchive] = useState<Account | null>(null);

  const scopes = useMemo(
    () =>
      new Map(
        workspaces.items.map((workspace) => [
          workspace.id,
          workspace.kind === 'family' ? t('family') : null,
        ]),
      ),
    [workspaces.items, t],
  );
  const choices = useMemo(
    () =>
      [...workspaces.items]
        .sort((a, b) => Number(b.kind === 'personal') - Number(a.kind === 'personal'))
        .map((workspace) => ({
          id: workspace.id,
          label: workspace.kind === 'family' ? `${t('family')}: ${workspace.name}` : t('personal'),
        })),
    [workspaces.items, t],
  );
  const currencies = useMemo(
    () => [...new Set([...COMMON_CURRENCIES, ...accounts.items.map((a) => a.currency)])],
    [accounts.items],
  );

  const active = accounts.items.filter((a) => a.archivedAt === null);
  const archived = accounts.items.filter((a) => a.archivedAt !== null);
  const blocked = !online;
  const add = (
    <Button disabled={blocked} onClick={() => setDialog('new')} className="active:scale-[0.97]">
      <Plus aria-hidden />
      {t('accounts.add')}
    </Button>
  );
  const row = (account: Account) => (
    <AccountRow
      key={account.id}
      account={account}
      scope={scopes.get(account.workspaceId) ?? null}
      disabled={blocked || admin.isPending}
      onEdit={() => setDialog({ account })}
      onArchive={() => setToArchive(account)}
      onRestore={() => void admin.archive(account.id, false)}
    />
  );

  let body: React.ReactNode;
  if (status === 'unavailable') {
    body = (
      <ErrorState
        title={states('error.title')}
        description={states('error.description')}
        onRetry={() => window.location.reload()}
      />
    );
  } else if (!accounts.ready || !workspaces.ready) {
    body = <LoadingState />;
  } else if (accounts.items.length === 0) {
    body = (
      <EmptyState
        icon={Wallet}
        title={pages('emptyTitle')}
        description={pages('emptyDescription')}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <ul className="rounded-xl border bg-card px-4">{active.map(row)}</ul>
        <ArchivedGroup count={archived.length}>
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
      {dialog && (
        <AccountDialog
          account={dialog === 'new' ? null : dialog.account}
          workspaces={choices}
          currencies={currencies}
          onClose={() => setDialog(null)}
        />
      )}
      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => !open && setToArchive(null)}
        title={t('accounts.archiveTitle', { name: toArchive?.name ?? '' })}
        description={t('accounts.archiveDescription')}
        confirmLabel={t('accounts.archiveConfirm')}
        onConfirm={() => {
          if (toArchive) void admin.archive(toArchive.id, true);
          setToArchive(null);
        }}
      />
    </div>
  );
}

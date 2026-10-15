import { SearchX, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  type TransactionDraft,
  useAccounts,
  useCategories,
  useDeleteTransaction,
  useLocalTransaction,
  useRecordTransaction,
  useUpdateTransaction,
  useWorkspaces,
} from '@data/sync';
import { type Scope, ScopeField } from '@features/family';
import { useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { ConfirmDialog, EmptyState, LoadingState, PageHeader } from '@shared/components';
import { todayIn } from '@shared/format';
import { Button } from '@shared/ui/button';
import { type FormValues, valuesFromDraft } from './form-values';
import { TransactionForm } from './transaction-form';

const LIST_PATH = '/transactions';

function draftOf(
  values: Omit<FormValues, 'amount'> & { amountMinor: number },
  workspaceId: string,
  note: string,
): TransactionDraft {
  return {
    workspaceId,
    kind: values.kind,
    amountMinor: values.amountMinor,
    currency: values.currency,
    occurredOn: values.occurredOn,
    accountId: values.accountId,
    categoryId: values.categoryId,
    description: values.description.trim(),
    note,
  };
}

export function NewTransactionPage() {
  const t = useTranslations();
  const navigate = useNavigate();
  const profile = useProfile();
  const workspaces = useWorkspaces();
  const accounts = useAccounts();
  const categories = useCategories();
  const record = useRecordTransaction();
  const saveFailed = () => toast.error(t('transactionForm.saveFailed'));
  const [scope, setScope] = useState<Scope>('personal');
  const personal = workspaces.items.find((workspace) => workspace.kind === 'personal');
  const family = workspaces.items.find((workspace) => workspace.kind === 'family');
  const target = scope === 'family' && family ? family : personal;
  const initial = useMemo<FormValues>(
    () => ({
      kind: 'expense',
      amount: '',
      currency: 'EUR',
      occurredOn: todayIn(profile.timezone),
      accountId: null,
      categoryId: null,
      description: '',
    }),
    [profile.timezone],
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={t('pages.addTransaction.title')}
        description={t('pages.addTransaction.description')}
      />
      {personal && target ? (
        <div className="flex max-w-xl flex-col gap-5">
          <ScopeField value={scope} onValueChange={setScope} />
          <TransactionForm
            // A family entry may also use the author's own personal account (BR-3). The form
            // restarts on a scope change because the other workspace's categories do not apply.
            key={target.id}
            initial={initial}
            accounts={accounts.items.filter(
              (a) => a.workspaceId === target.id || a.workspaceId === personal.id,
            )}
            categories={categories.items.filter((c) => c.workspaceId === target.id)}
            onSubmit={async (values) => {
              try {
                await record(draftOf(values, target.id, ''));
                await navigate(LIST_PATH);
              } catch {
                saveFailed();
              }
            }}
          />
        </div>
      ) : (
        <LoadingState rows={4} />
      )}
    </div>
  );
}

export function EditTransactionPage() {
  const t = useTranslations();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { ready, entry } = useLocalTransaction(id);
  const personal = useWorkspaces().items.find((workspace) => workspace.kind === 'personal');
  const accounts = useAccounts();
  const categories = useCategories();
  const update = useUpdateTransaction();
  const remove = useDeleteTransaction();
  const saveFailed = () => toast.error(t('transactionForm.saveFailed'));
  const [confirming, setConfirming] = useState(false);

  const header = (
    <PageHeader
      title={t('pages.editTransaction.title')}
      description={t('pages.editTransaction.description')}
    />
  );
  if (!ready) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <LoadingState rows={4} />
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <EmptyState
          icon={SearchX}
          title={t('pages.editTransaction.notFoundTitle')}
          description={t('pages.editTransaction.notFoundDescription')}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {header}
      <TransactionForm
        key={entry.id}
        initial={valuesFromDraft(entry)}
        accounts={accounts.items.filter(
          (a) => a.workspaceId === entry.workspaceId || a.workspaceId === personal?.id,
        )}
        categories={categories.items.filter((c) => c.workspaceId === entry.workspaceId)}
        onSubmit={async (values) => {
          try {
            await update(entry.id, draftOf(values, entry.workspaceId, entry.note));
            await navigate(LIST_PATH);
          } catch {
            saveFailed();
          }
        }}
        footer={
          <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden />
            {t('transactionForm.delete')}
          </Button>
        }
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('transactionForm.deleteTitle')}
        description={t('transactionForm.deleteDescription')}
        confirmLabel={t('transactionForm.delete')}
        onConfirm={() => {
          setConfirming(false);
          void navigate(LIST_PATH);
          remove(entry.id).catch(saveFailed);
        }}
      />
    </div>
  );
}

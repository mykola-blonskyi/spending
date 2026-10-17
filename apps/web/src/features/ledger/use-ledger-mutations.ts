import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorCode } from '@data/api-error';
import {
  type AccountCreate,
  type AccountPatch,
  createAccount,
  createCategory,
  type CategoryCreate,
  type CategoryPatch,
  updateAccount,
  updateCategory,
} from '@data/ledger';
import { isSignedOutError } from '@data/session';
import { useSyncNow } from '@data/sync';
import { useTranslations } from '@i18n/index';

/**
 * Runs one write against the API, then refreshes the local store so lists and pickers show it.
 * Not optimistic: a new row needs the server's id. Resolves to whether the write succeeded, so a
 * dialog can stay open on failure; the failure itself is already toasted.
 */
function useLedgerWrite() {
  const t = useTranslations();
  const refresh = useSyncNow();
  const mutation = useMutation({
    mutationFn: (write: () => Promise<unknown>) => write(),
    onSuccess: async () => {
      // The write is saved; if the refresh fails, the next sync brings the change in.
      await refresh().catch(() => {});
    },
    onError: (error) => {
      if (!isSignedOutError(error)) toast.error(t(`errors.${errorCode(error)}`));
    },
  });
  const run = (write: () => Promise<unknown>) =>
    mutation.mutateAsync(write).then(
      () => true,
      () => false,
    );
  return { run, isPending: mutation.isPending };
}

export function useAccountsAdmin() {
  const { run, isPending } = useLedgerWrite();
  return {
    isPending,
    create: (input: AccountCreate) => run(() => createAccount(input)),
    update: (
      id: string,
      patch: Pick<AccountPatch, 'name' | 'kind' | 'openingBalanceMinor' | 'openingOn'>,
    ) => run(() => updateAccount(id, patch)),
    archive: (id: string, archived: boolean) => run(() => updateAccount(id, { archived })),
  };
}

export function useCategoriesAdmin() {
  const { run, isPending } = useLedgerWrite();
  return {
    isPending,
    create: (input: CategoryCreate) => run(() => createCategory(input)),
    update: (id: string, patch: Pick<CategoryPatch, 'name' | 'color' | 'icon'>) =>
      run(() => updateCategory(id, patch)),
    archive: (id: string, archived: boolean) => run(() => updateCategory(id, { archived })),
  };
}

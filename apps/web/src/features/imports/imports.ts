import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorCode } from '@data/api-error';
import {
  confirmReview,
  clearUndoneImports,
  createImport,
  importBatchesQuery,
  learnCategories,
  type LearnItem,
  removeImport,
  reviewQueueQuery,
  undoImport,
} from '@data/imports';
import { isSignedOutError } from '@data/session';
import { useSyncNow, useWorkspaces } from '@data/sync';
import { useTranslations } from '@i18n/index';

export const useImportBatches = () => useQuery(importBatchesQuery);

/** Whether the user is in a family, so imports wait for review (BR-28). */
export function useHasFamily(): boolean {
  return useWorkspaces().items.some((workspace) => workspace.kind === 'family');
}

export function useReviewQueue() {
  return useQuery({ ...reviewQueueQuery, enabled: useHasFamily() });
}

function useExplainFailure() {
  const t = useTranslations();
  return (error: unknown) => {
    if (!isSignedOutError(error)) toast.error(t(`errors.${errorCode(error)}`));
  };
}

/**
 * BR-29: the bank category of each row imported in this tab, by transaction ID. Never stored, so
 * only categories chosen before a reload teach a bank-category rule.
 */
const bankCategories = new Map<string, string>();
export const bankCategoryOf = (transactionId: string) => bankCategories.get(transactionId);

/** Teaches the bank categories of these choices; best effort, the category change itself syncs. */
export function learnBankCategories(
  choices: { transactionId: string; categoryId: string | null }[],
) {
  const items = choices.flatMap(({ transactionId, categoryId }): LearnItem[] => {
    const bankCategory = bankCategoryOf(transactionId);
    return bankCategory && categoryId ? [{ transactionId, categoryId, bankCategory }] : [];
  });
  if (items.length > 0) learnCategories(items).catch(() => {});
}

/** Imports write on the server, so a pull brings the new rows to this device. */
export function useCreateImport() {
  const queryClient = useQueryClient();
  const syncNow = useSyncNow();
  return useMutation({
    mutationFn: createImport,
    onError: useExplainFailure(),
    onSuccess: (result) => {
      for (const [id, bankCategory] of Object.entries(result.imported.bankCategories)) {
        bankCategories.set(id, bankCategory);
      }
      void queryClient.invalidateQueries({ queryKey: importBatchesQuery.queryKey });
      void syncNow();
    },
  });
}

export function useUndoImport() {
  const queryClient = useQueryClient();
  const syncNow = useSyncNow();
  return useMutation({
    mutationFn: undoImport,
    onError: useExplainFailure(),
    onSuccess: (result) => {
      queryClient.setQueryData(importBatchesQuery.queryKey, (batches) =>
        batches?.map((batch) => (batch.id === result.batch.id ? result.batch : batch)),
      );
      void syncNow();
    },
  });
}

export function useRemoveImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeImport,
    onError: useExplainFailure(),
    onSuccess: (_, id) =>
      queryClient.setQueryData(importBatchesQuery.queryKey, (batches) =>
        batches?.filter((batch) => batch.id !== id),
      ),
  });
}

export function useClearUndoneImports() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearUndoneImports,
    onError: useExplainFailure(),
    onSuccess: () =>
      queryClient.setQueryData(importBatchesQuery.queryKey, (batches) =>
        batches?.filter((batch) => !batch.undoneAt),
      ),
  });
}

export function useConfirmReview() {
  const queryClient = useQueryClient();
  const syncNow = useSyncNow();
  return useMutation({
    mutationFn: confirmReview,
    onError: useExplainFailure(),
    onSuccess: (published) => {
      const done = new Set(published.map((row) => row.id));
      queryClient.setQueryData(reviewQueueQuery.queryKey, (items) =>
        items?.filter((item) => !done.has(item.transaction.id)),
      );
      void syncNow();
    },
  });
}

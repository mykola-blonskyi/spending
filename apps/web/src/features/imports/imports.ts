import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorCode } from '@data/api-error';
import {
  confirmReview,
  createImport,
  importBatchesQuery,
  reviewQueueQuery,
  undoImport,
} from '@data/imports';
import { isSignedOutError } from '@data/session';
import { useRequestSync, useWorkspaces } from '@data/sync';
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

/** Imports write on the server, so a pull brings the new rows to this device. */
export function useCreateImport() {
  const queryClient = useQueryClient();
  const requestSync = useRequestSync();
  return useMutation({
    mutationFn: createImport,
    onError: useExplainFailure(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: importBatchesQuery.queryKey });
      void requestSync();
    },
  });
}

export function useUndoImport() {
  const queryClient = useQueryClient();
  const requestSync = useRequestSync();
  return useMutation({
    mutationFn: undoImport,
    onError: useExplainFailure(),
    onSuccess: (result) => {
      queryClient.setQueryData(importBatchesQuery.queryKey, (batches) =>
        batches?.map((batch) => (batch.id === result.batch.id ? result.batch : batch)),
      );
      void requestSync();
    },
  });
}

export function useConfirmReview() {
  const queryClient = useQueryClient();
  const requestSync = useRequestSync();
  return useMutation({
    mutationFn: confirmReview,
    onError: useExplainFailure(),
    onSuccess: (published) => {
      const done = new Set(published.map((row) => row.id));
      queryClient.setQueryData(reviewQueueQuery.queryKey, (items) =>
        items?.filter((item) => !done.has(item.transaction.id)),
      );
      void requestSync();
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorCode } from '@data/api-error';
import { FAMILY_KEY, type WorkspaceView, workspacesQuery } from '@data/family';
import { isSignedOutError } from '@data/session';
import { useRequestSync } from '@data/sync';
import { useTranslations } from '@i18n/index';

export const findFamily = (workspaces: readonly WorkspaceView[]): WorkspaceView | null =>
  workspaces.find((workspace) => workspace.kind === 'family') ?? null;

/** The family the signed-in user belongs to; `data` is null without one. */
export function useFamily(enabled = true) {
  return useQuery({ ...workspacesQuery, select: findFamily, enabled });
}

/**
 * A family change on the server: refreshes every family query and asks the sync engine to pull,
 * so the local store picks up (or drops) the family's entries, accounts and categories.
 */
export function useFamilyMutation<A, R>(
  mutationFn: (arg: A) => Promise<R>,
  onSuccess?: (result: R, arg: A) => void,
) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const requestSync = useRequestSync();
  return useMutation({
    mutationFn,
    onSuccess: async (result, arg) => {
      await queryClient.invalidateQueries({ queryKey: FAMILY_KEY });
      void requestSync();
      onSuccess?.(result, arg);
    },
    onError: (error) => {
      if (!isSignedOutError(error)) toast.error(t(`errors.${errorCode(error)}`));
    },
  });
}

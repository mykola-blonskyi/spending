import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorCode } from '@data/api-error';
import { clearLocalUserData } from '@data/local-data';
import { isSignedOutError, logout } from '@data/session';
import { countUnsentMutations } from '@data/sync';
import { useTranslations } from '@i18n/index';
import { ConfirmDialog } from '@shared/components';
import { loadPage } from '@shared/lib/navigation';
import { SIGN_IN_PATH } from './return-to';
import { useSession } from './session-context';

/**
 * Explicit sign-out: ends the server session, removes this user's local data, then leaves
 * through the provider's end-session URL. The caller renders `dialog`; it opens only when
 * changes on this device have not reached the server and would be deleted.
 */
export function useSignOut() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const [confirming, setConfirming] = useState(false);

  const leave = async (endSessionUrl: string | null) => {
    try {
      await clearLocalUserData(queryClient, user.id);
    } finally {
      loadPage(endSessionUrl ?? SIGN_IN_PATH);
    }
  };

  const mutation = useMutation({
    mutationFn: logout,
    onSuccess: ({ endSessionUrl }) => leave(endSessionUrl),
    onError: (error) => {
      if (isSignedOutError(error)) void leave(null);
      else toast.error(t(`errors.${errorCode(error)}`));
    },
  });

  const request = () => {
    let unsent: number;
    try {
      unsent = countUnsentMutations(user.id);
    } catch {
      // Losing unsynced work silently is worse than one extra question.
      unsent = 1;
    }
    if (unsent > 0) setConfirming(true);
    else mutation.mutate();
  };

  const dialog = (
    <ConfirmDialog
      open={confirming}
      onOpenChange={setConfirming}
      title={t('signOut.pendingTitle')}
      description={t('signOut.pendingDescription')}
      confirmLabel={t('signOut.pendingConfirm')}
      onConfirm={() => {
        setConfirming(false);
        mutation.mutate();
      }}
    />
  );

  return { request, busy: mutation.isPending || mutation.isSuccess, dialog };
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorCode } from '@data/api-error';
import { clearLocalUserData } from '@data/local-data';
import { isSignedOutError, logout } from '@data/session';
import { useTranslations } from '@i18n/index';
import { loadPage } from '@shared/lib/navigation';
import { SIGN_IN_PATH } from './return-to';
import { useSession } from './session-context';

/**
 * Explicit sign-out: ends the server session, removes this user's local data, then leaves
 * through the provider's end-session URL.
 */
export function useSignOut() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { user } = useSession();

  const leave = (endSessionUrl: string | null) => {
    clearLocalUserData(queryClient, user.id);
    loadPage(endSessionUrl ?? SIGN_IN_PATH);
  };

  const mutation = useMutation({
    mutationFn: logout,
    onSuccess: ({ endSessionUrl }) => leave(endSessionUrl),
    onError: (error) => {
      if (isSignedOutError(error)) leave(null);
      else toast.error(t(`errors.${errorCode(error)}`));
    },
  });

  return {
    request: () => mutation.mutate(),
    busy: mutation.isPending || mutation.isSuccess,
  };
}

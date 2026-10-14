import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { errorCode } from '@data/api-error';
import { sessionQuery } from '@data/session';
import { useTranslations } from '@i18n/index';
import { ErrorState, LoadingState } from '@shared/components';
import { safeReturnTo, signInPath } from './return-to';
import { SessionContext } from './session-context';
import { resetSignInAttempts } from './signin-attempts';

/** Fades in only if the check is slow, so a fast session check never flashes a skeleton. */
function SessionSkeleton() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl animate-in flex-col gap-6 px-4 pt-20 delay-300 duration-200 fill-mode-backwards fade-in-0 sm:px-6 lg:px-10">
      <LoadingState rows={6} />
    </div>
  );
}

export function RequireSession({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const { pathname, search } = useLocation();
  const session = useQuery(sessionQuery);

  useEffect(() => {
    if (session.data) resetSignInAttempts();
  }, [session.data]);

  if (session.data === null) return <Navigate to={signInPath(pathname + search)} replace />;
  if (session.data) return <SessionContext value={session.data}>{children}</SessionContext>;
  if (session.isError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
        <ErrorState
          title={t('states.error.title')}
          description={t(`errors.${errorCode(session.error)}`)}
          onRetry={() => void session.refetch()}
        />
      </main>
    );
  }
  return <SessionSkeleton />;
}

/** Wraps the sign-in page: someone already signed in goes straight to where they were heading. */
export function RedirectIfSignedIn({ children }: { children: React.ReactNode }) {
  const [params] = useSearchParams();
  const session = useQuery(sessionQuery);
  if (session.data) return <Navigate to={safeReturnTo(params.get('returnTo'))} replace />;
  return children;
}

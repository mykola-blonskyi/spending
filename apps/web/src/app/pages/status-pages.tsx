import { Compass } from 'lucide-react';
import { isRouteErrorResponse, Link, useParams, useRouteError } from 'react-router';
import { errorCode } from '@data/api-error';
import { InviteFlow } from '@features/family';
import { useTranslations } from '@i18n/index';
import { EmptyState, ErrorState } from '@shared/components';
import { Button } from '@shared/ui/button';
import { BrandMark } from '../brand';

export function NotFoundPage() {
  const t = useTranslations();
  return (
    <EmptyState
      className="my-8"
      icon={Compass}
      title={t('states.notFound.title')}
      description={t('states.notFound.description')}
      action={
        <Button asChild variant="outline">
          <Link to="/">{t('actions.goHome')}</Link>
        </Button>
      }
    />
  );
}

export function RouteErrorPage() {
  const t = useTranslations();
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  const code = errorCode(error);
  return (
    <ErrorState
      className="my-8"
      title={t('states.error.title')}
      description={code === 'INTERNAL' ? t('states.error.description') : t(`errors.${code}`)}
      onRetry={() => window.location.reload()}
    />
  );
}

export function InvitePage() {
  const { token = '' } = useParams();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-8 px-4 text-center">
      <BrandMark className="size-12" />
      <InviteFlow token={token} />
    </main>
  );
}

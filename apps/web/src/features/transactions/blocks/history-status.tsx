import { ArrowLeftRight, Plus, SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslations } from '@i18n/index';
import { EmptyState, ErrorState, LoadingState } from '@shared/components';
import { Button } from '@shared/ui/button';
import { Progress } from '@shared/ui/progress';
import type { HistoryStatus as Status } from '../use-history';
import type { EntryStatus as FormStatus } from '../use-entry-form';

function Unavailable({ className }: { className?: string | undefined }) {
  const t = useTranslations('history');
  return (
    <ErrorState
      title={t('unavailableTitle')}
      description={t('unavailableDescription')}
      className={className}
    />
  );
}

/** What history shows instead of rows; nothing once there are rows. */
export function HistoryStatus({
  status,
  loaded,
  className,
}: {
  status: Status;
  loaded: number;
  className?: string;
}) {
  const t = useTranslations();
  switch (status) {
    case 'ready':
      return null;
    case 'loading':
      return <LoadingState rows={6} className={className} />;
    case 'unavailable':
      return <Unavailable className={className} />;
    case 'firstSync':
      return (
        <div role="status" className={className}>
          <Progress
            aria-label={t('pages.transactions.firstSync')}
            className="animate-pulse"
            value={null}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            {t('pages.transactions.firstSync')}{' '}
            {t('pages.transactions.firstSyncLoaded', { count: loaded })}
          </p>
        </div>
      );
    case 'empty':
      return (
        <EmptyState
          icon={ArrowLeftRight}
          title={t('pages.transactions.emptyTitle')}
          description={t('pages.transactions.emptyDescription')}
          className={className}
          action={
            <Button asChild>
              <Link to="/transactions/new">
                <Plus aria-hidden />
                {t('nav.addTransaction')}
              </Link>
            </Button>
          }
        />
      );
    case 'noMatches':
      return (
        <EmptyState
          icon={ArrowLeftRight}
          title={t('pages.transactions.noMatchesTitle')}
          description={t('pages.transactions.noMatchesDescription')}
          className={className}
        />
      );
  }
}

/** What an entry screen shows until its form can render. */
export function EntryStatus({ status, className }: { status: FormStatus; className?: string }) {
  const t = useTranslations('pages.editTransaction');
  switch (status) {
    case 'ready':
      return null;
    case 'loading':
      return <LoadingState rows={4} className={className} />;
    case 'unavailable':
      return <Unavailable className={className} />;
    case 'notFound':
      return (
        <EmptyState
          icon={SearchX}
          title={t('notFoundTitle')}
          description={t('notFoundDescription')}
          className={className}
        />
      );
  }
}

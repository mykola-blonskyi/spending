import type { UseQueryResult } from '@tanstack/react-query';
import { CloudOff } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@shared/components';
import { useSharedLocale } from '@shared/lib/locale-context';
import { errorCode } from './api-error';

/** What a server-backed list shows while it has no rows to show: offline, failed, or loading. */
export function QueryUnavailable({
  query,
  offlineTitle,
  offlineDescription,
}: {
  query: UseQueryResult<unknown>;
  offlineTitle: string;
  offlineDescription: string;
}) {
  const { strings } = useSharedLocale();
  const offline =
    query.fetchStatus === 'paused' || (query.isError && errorCode(query.error) === 'NETWORK');
  if (offline) {
    return <EmptyState icon={CloudOff} title={offlineTitle} description={offlineDescription} />;
  }
  if (query.isError) {
    return (
      <ErrorState
        title={strings.apiError(errorCode(query.error))}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <LoadingState variant="cards" rows={4} />;
}

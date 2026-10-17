import { AlertTriangle, CloudUpload, GitCompare, type LucideIcon } from 'lucide-react';
import type { EntrySync } from '@data/sync';
import { useTranslations } from '@i18n/index';
import { cn } from '@shared/lib/utils';
import { Alert, AlertDescription } from '@shared/ui/alert';

type Marker = { icon: LucideIcon; label: string; tone: string };

/** "Not synced: <why the server refused the change>". */
function useFailedLabel(): (code: string) => string {
  const t = useTranslations();
  return (code) => {
    const key = `errors.${code}` as 'errors.INTERNAL';
    return t('pages.transactions.failed', { reason: t.has(key) ? t(key) : t('errors.INTERNAL') });
  };
}

/** Why the server refused an entry's change, in full above its form, so the user can fix it. */
export function SyncFailure({ sync, className }: { sync: EntrySync | null; className?: string }) {
  const failedLabel = useFailedLabel();
  if (sync?.state !== 'failed') return null;
  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle aria-hidden />
      <AlertDescription className="text-destructive">{failedLabel(sync.code)}</AlertDescription>
    </Alert>
  );
}

/** How an entry stands with the server, shown only when it is not simply synced. */
export function SyncMarker({ sync, className }: { sync: EntrySync; className?: string }) {
  const t = useTranslations();
  const failedLabel = useFailedLabel();
  let marker: Marker;
  switch (sync.state) {
    case 'synced':
      return null;
    case 'pending':
      marker = {
        icon: CloudUpload,
        label: t('pages.transactions.pending'),
        tone: 'text-warning-foreground',
      };
      break;
    case 'failed':
      marker = { icon: AlertTriangle, label: failedLabel(sync.code), tone: 'text-destructive' };
      break;
    case 'conflict':
      marker = {
        icon: GitCompare,
        label: t('pages.transactions.conflict'),
        tone: 'text-destructive',
      };
      break;
  }
  const Icon = marker.icon;
  return (
    <span
      data-sync={sync.state}
      className={cn('inline-flex min-w-0 items-center gap-1 text-xs', marker.tone, className)}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{marker.label}</span>
    </span>
  );
}

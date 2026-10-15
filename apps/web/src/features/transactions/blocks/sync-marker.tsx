import { AlertTriangle, CloudUpload, GitCompare, type LucideIcon } from 'lucide-react';
import type { EntrySync } from '@data/sync';
import { useTranslations } from '@i18n/index';
import { cn } from '@shared/lib/utils';

type Marker = { icon: LucideIcon; label: string; tone: string };

/** How an entry stands with the server, shown only when it is not simply synced. */
export function SyncMarker({ sync, className }: { sync: EntrySync; className?: string }) {
  const t = useTranslations();
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
    case 'failed': {
      const key = `errors.${sync.code}` as 'errors.INTERNAL';
      const reason = t.has(key) ? t(key) : t('errors.INTERNAL');
      marker = {
        icon: AlertTriangle,
        label: t('pages.transactions.failed', { reason }),
        tone: 'text-destructive',
      };
      break;
    }
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

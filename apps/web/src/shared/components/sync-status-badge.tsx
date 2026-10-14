import { AlertTriangle, CheckCircle2, CloudUpload, RefreshCw, type LucideIcon } from 'lucide-react';
import { type SharedStrings, useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';

export type SyncStatus =
  | { state: 'synced' }
  | { state: 'syncing' }
  | { state: 'pending'; count: number }
  | { state: 'failed' }
  | { state: 'conflict'; count: number };

type Appearance = {
  icon: LucideIcon;
  tone: string;
  label: (status: SyncStatus, strings: SharedStrings) => string;
  spin?: boolean;
};

const count = (status: SyncStatus) => ('count' in status ? status.count : 0);

const APPEARANCE: Record<SyncStatus['state'], Appearance> = {
  synced: {
    icon: CheckCircle2,
    tone: 'text-muted-foreground',
    label: (_, strings) => strings.synced,
  },
  syncing: {
    icon: RefreshCw,
    tone: 'text-muted-foreground',
    label: (_, strings) => strings.syncing,
    spin: true,
  },
  pending: {
    icon: CloudUpload,
    tone: 'bg-warning/15 text-warning-foreground',
    label: (status, strings) => strings.syncPending(count(status)),
  },
  failed: {
    icon: AlertTriangle,
    tone: 'bg-destructive/10 text-destructive',
    label: (_, strings) => strings.syncFailed,
  },
  conflict: {
    icon: AlertTriangle,
    tone: 'bg-destructive/10 text-destructive',
    label: (status, strings) => strings.syncConflict(count(status)),
  },
};

export function SyncStatusBadge({ status, className }: { status: SyncStatus; className?: string }) {
  const { strings } = useSharedLocale();
  const appearance = APPEARANCE[status.state];
  const Icon = appearance.icon;
  return (
    <span
      role="status"
      data-state={status.state}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        appearance.tone,
        className,
      )}
    >
      <Icon aria-hidden className={cn('size-3.5', appearance.spin && 'animate-spin')} />
      {appearance.label(status, strings)}
    </span>
  );
}

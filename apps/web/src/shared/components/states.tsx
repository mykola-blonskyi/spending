import { AlertTriangle, CloudOff, type LucideIcon } from 'lucide-react';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';

type StateProps = {
  title: string;
  description?: string;
  className?: string;
};

function StateIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: 'neutral' | 'danger' }) {
  return (
    <div
      className={cn(
        'flex size-12 items-center justify-center rounded-full',
        tone === 'danger'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-accent text-accent-foreground',
      )}
    >
      <Icon aria-hidden className="size-6" strokeWidth={1.75} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: StateProps & { icon: LucideIcon; action?: React.ReactNode }) {
  return (
    <section
      className={cn(
        'flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      <StateIcon icon={icon} tone="neutral" />
      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="text-base font-semibold text-balance">{title}</h2>
        {description && <p className="text-sm text-pretty text-muted-foreground">{description}</p>}
      </div>
      {action}
    </section>
  );
}

export function ErrorState({
  title,
  description,
  onRetry,
  className,
}: StateProps & { onRetry?: () => void }) {
  const { strings } = useSharedLocale();
  return (
    <section
      role="alert"
      className={cn('flex flex-col items-center gap-4 px-6 py-12 text-center', className)}
    >
      <StateIcon icon={AlertTriangle} tone="danger" />
      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="text-base font-semibold text-balance">{title}</h2>
        {description && <p className="text-sm text-pretty text-muted-foreground">{description}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          {strings.retry}
        </Button>
      )}
    </section>
  );
}

export function LoadingState({
  variant = 'list',
  rows = 5,
  className,
}: {
  variant?: 'list' | 'cards';
  rows?: number;
  className?: string;
}) {
  const { strings } = useSharedLocale();
  const items = Array.from({ length: rows }, (_, index) => index);
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{strings.loading}</span>
      {variant === 'cards' ? (
        <div aria-hidden className="grid gap-4 sm:grid-cols-2">
          {items.map((index) => (
            <div key={index} className="flex flex-col gap-3 rounded-xl border p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-36" />
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <ul aria-hidden className="flex flex-col divide-y">
          {items.map((index) => (
            <li key={index} className="flex items-center gap-3 py-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-4 w-16" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OfflineBanner({ className }: { className?: string }) {
  const { strings } = useSharedLocale();
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 border-b bg-muted/60 px-4 py-2.5 text-sm sm:items-center',
        className,
      )}
    >
      <CloudOff aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground sm:mt-0" />
      <p className="text-pretty">
        <span className="font-medium">{strings.offlineTitle}.</span>{' '}
        <span className="text-muted-foreground">{strings.offlineDescription}</span>
      </p>
    </div>
  );
}

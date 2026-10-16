import { Archive, ChevronRight, Pencil, Undo2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslations } from '@i18n/index';
import { cn } from '@shared/lib/utils';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';

export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const touchButton = 'size-11 sm:size-9';

/** Edit and archive (or restore) for one row; both stay out of the way of the row's text. */
export function RowActions({
  name,
  archived,
  disabled,
  onEdit,
  onArchive,
  onRestore,
}: {
  name: string;
  archived: boolean;
  disabled: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const t = useTranslations('ledger');
  return (
    <div className="flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="icon"
        className={cn(touchButton, 'active:scale-[0.97]')}
        disabled={disabled}
        aria-label={t('editLabel', { name })}
        onClick={onEdit}
      >
        <Pencil aria-hidden />
      </Button>
      {archived ? (
        <Button
          variant="ghost"
          size="icon"
          className={cn(touchButton, 'active:scale-[0.97]')}
          disabled={disabled}
          aria-label={t('restoreLabel', { name })}
          onClick={onRestore}
        >
          <Undo2 aria-hidden />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className={cn(touchButton, 'active:scale-[0.97]')}
          disabled={disabled}
          aria-label={t('archiveLabel', { name })}
          onClick={onArchive}
        >
          <Archive aria-hidden />
        </Button>
      )}
    </div>
  );
}

/** Archived rows stay reachable (to restore them) but out of the way until asked for. */
export function ArchivedGroup({
  count,
  forceOpen = false,
  children,
}: {
  count: number;
  /** Opens the group (and leaves it open) when a row inside it is being revealed. */
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations('ledger');
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (forceOpen && details.current) details.current.open = true;
  }, [forceOpen]);
  if (count === 0) return null;
  return (
    <details ref={details} className="group/archived opacity-80">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 transition-transform duration-200 ease-out group-open/archived:rotate-90"
        />
        {t('archivedSection')} ({count})
      </summary>
      {children}
    </details>
  );
}

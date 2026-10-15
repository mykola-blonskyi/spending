import { cn } from '@shared/lib/utils';

/**
 * A plain data table that scrolls sideways on narrow screens instead of squeezing cells. The
 * wrapper is positioned so screen-reader-only text in a cell stays inside the scroll area
 * instead of widening the page.
 */
export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="relative w-full overflow-x-auto rounded-xl border">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn(
        'h-10 border-b bg-muted/50 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2 align-middle', className)} {...props} />;
}

export function Tr({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr className={cn('border-b last:border-b-0', className)} {...props} />;
}

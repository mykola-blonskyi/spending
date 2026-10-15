import { useId } from 'react';
import { cn } from '@shared/lib/utils';

/** A titled dashboard section; layouts style its surface through `className`. */
export function Section({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-3', className)}>
      <h2 id={id} className="text-sm font-semibold text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

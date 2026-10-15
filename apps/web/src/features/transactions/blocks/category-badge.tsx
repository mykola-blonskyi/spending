import { Tag } from 'lucide-react';
import type { CategoryView } from '@features/ledger';
import { cn } from '@shared/lib/utils';

/** The category's icon in a circle tinted with its color; muted when there is no category. */
export function CategoryBadge({
  category,
  className,
}: {
  category: CategoryView | undefined;
  className?: string;
}) {
  const Icon = category?.Icon ?? Tag;
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full',
        !category && 'bg-muted text-muted-foreground',
        className,
      )}
      style={
        category && {
          backgroundColor: `color-mix(in oklch, ${category.color} 15%, transparent)`,
          color: category.color,
        }
      }
    >
      <Icon className="size-[45%]" strokeWidth={1.9} />
    </span>
  );
}

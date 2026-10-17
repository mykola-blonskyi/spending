import { Tag } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { CategoryView } from '@features/ledger';
import { cn } from '@shared/lib/utils';

/**
 * The category's icon in a circle tinted with its color; muted when there is no category. Dark
 * mode lightens the icon, since the stored colors are dark enough to vanish on the tint.
 */
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
        category
          ? 'bg-[color-mix(in_oklch,var(--category)_15%,transparent)] text-(--category) dark:text-[color-mix(in_oklch,var(--category)_70%,white)]'
          : 'bg-muted text-muted-foreground',
        className,
      )}
      style={category && ({ '--category': category.color } as CSSProperties)}
    >
      <Icon className="size-[45%]" strokeWidth={1.9} />
    </span>
  );
}

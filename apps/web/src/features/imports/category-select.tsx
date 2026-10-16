import type { CategoryView } from '@features/ledger';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';

const NONE = 'none';

/** Picks one of the given categories, or none. The caller filters by workspace and kind. */
export function CategorySelect({
  value,
  categories,
  onChange,
  label,
  noneLabel,
  className,
}: {
  value: string | null;
  categories: readonly CategoryView[];
  onChange: (categoryId: string | null) => void;
  label: string;
  noneLabel: string;
  className?: string;
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(next) => onChange(next === NONE ? null : next)}>
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {categories.map((category) => (
          <SelectItem key={category.id} value={category.id}>
            {category.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

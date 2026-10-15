import type { ConfirmItem } from '@data/imports';
import type { Category } from '@data/sync';

export type Scope = ConfirmItem['scope'];
export type Choice = { scope: Scope; categoryId: string | null };

/** The bulk category lands only on rows in the bulk scope and of its kind; the rest keep theirs. */
export function bulkCategoryChoice(
  choice: Choice,
  kind: Category['kind'],
  bulkScope: Scope,
  category: Category,
): Choice {
  if (choice.scope !== bulkScope || kind !== category.kind) return choice;
  return { ...choice, categoryId: category.id };
}

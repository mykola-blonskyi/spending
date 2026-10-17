import type { ConfirmItem } from '@data/imports';
import type { Category } from '@data/sync';

export type Scope = ConfirmItem['scope'];
/** BR-38: a transfer is personal and has no category, so it carries neither choice. */
export type Choice =
  | { scope: Scope; categoryId: string | null; transfer?: undefined }
  | { scope: 'personal'; categoryId: null; transfer: { counterpartId: string | null } };

export const transferChoice = (counterpartId: string | null): Choice => ({
  scope: 'personal',
  categoryId: null,
  transfer: { counterpartId },
});

/** The bulk category lands only on rows in the bulk scope and of its kind; the rest keep theirs. */
export function bulkCategoryChoice(
  choice: Choice,
  kind: Category['kind'],
  bulkScope: Scope,
  category: Pick<Category, 'id' | 'kind'>,
): Choice {
  if (choice.transfer || choice.scope !== bulkScope || kind !== category.kind) return choice;
  return { ...choice, categoryId: category.id };
}

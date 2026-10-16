import type { LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { type Category, useCategories } from '@data/sync';
import { type Messages, useTranslations } from '@i18n/index';
import { useSharedLocale } from '@shared/lib/locale-context';
import { categoryIcon } from './category-icons';

export type CategoryView = Readonly<{
  id: string;
  workspaceId: string;
  kind: Category['kind'];
  /** The user's name, or the localized default for an unnamed default category (ADR-012). */
  name: string;
  color: string;
  Icon: LucideIcon;
  archived: boolean;
}>;

type DefaultKey = keyof Messages['categoryDefaults'];
type Translate = (key: DefaultKey) => string;

/** How a default category is shown while the user has not named it. */
export function defaultCategoryName(systemKey: string, t: Translate): string {
  return t(systemKey as DefaultKey);
}

/** Pure: how a category is shown. `t` translates `categoryDefaults.<systemKey>`. */
export function categoryView(category: Category, t: Translate): CategoryView {
  const { name, systemKey } = category;
  return {
    id: category.id,
    workspaceId: category.workspaceId,
    kind: category.kind,
    name: name ?? (systemKey === null ? '' : defaultCategoryName(systemKey, t)),
    color: category.color,
    Icon: categoryIcon(category.icon),
    archived: category.archivedAt !== null,
  };
}

/**
 * The category of the same workspace and kind whose displayed name reads the same as `name`
 * (trimmed, case-insensitive, accents kept), archived ones included (BR-4a).
 */
export function findDuplicateCategory(
  views: readonly CategoryView[],
  target: { name: string; workspaceId: string; kind: Category['kind']; exceptId?: string },
  locale: string,
): CategoryView | undefined {
  const collator = new Intl.Collator(locale, { sensitivity: 'accent' });
  const name = target.name.trim();
  return views.find(
    (view) =>
      view.id !== target.exceptId &&
      view.workspaceId === target.workspaceId &&
      view.kind === target.kind &&
      collator.compare(view.name.trim(), name) === 0,
  );
}

/** The one place categories get their display names; every list, picker and label uses it. */
export function useCategoryViews(): {
  ready: boolean;
  items: readonly CategoryView[];
  byId: ReadonlyMap<string, CategoryView>;
} {
  const t = useTranslations('categoryDefaults');
  const { locale } = useSharedLocale();
  const categories = useCategories();
  return useMemo(() => {
    const items = categories.items
      .map((category) => categoryView(category, t))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
    return { ready: categories.ready, items, byId: new Map(items.map((c) => [c.id, c])) };
  }, [categories, t, locale]);
}

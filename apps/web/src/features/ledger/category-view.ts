import type { LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { type Category, useCategories } from '@data/sync';
import { type Messages, useTranslations } from '@i18n/index';
import { en } from '@i18n/messages/en';
import { categoryIcon } from './category-icons';

export type CategoryView = Readonly<{
  id: string;
  workspaceId: string;
  kind: Category['kind'];
  /** Localized for a default category whose stored name is still the English default. */
  name: string;
  color: string;
  Icon: LucideIcon;
  archived: boolean;
}>;

type DefaultKey = keyof Messages['categoryDefaults'];
type Translate = (key: DefaultKey) => string;

const isDefaultKey = (key: string): key is DefaultKey => key in en.categoryDefaults;

/** Pure: how a category is shown. `t` translates `categoryDefaults.<systemKey>`. */
export function categoryView(category: Category, t: Translate): CategoryView {
  const { systemKey } = category;
  const localized =
    systemKey !== null &&
    isDefaultKey(systemKey) &&
    category.name === en.categoryDefaults[systemKey];
  return {
    id: category.id,
    workspaceId: category.workspaceId,
    kind: category.kind,
    name: localized ? t(systemKey) : category.name,
    color: category.color,
    Icon: categoryIcon(category.icon),
    archived: category.archivedAt !== null,
  };
}

export function useCategoryViews(): {
  ready: boolean;
  items: readonly CategoryView[];
  byId: ReadonlyMap<string, CategoryView>;
} {
  const t = useTranslations('categoryDefaults');
  const categories = useCategories();
  return useMemo(() => {
    const items = categories.items.map((category) => categoryView(category, t));
    return { ready: categories.ready, items, byId: new Map(items.map((c) => [c.id, c])) };
  }, [categories, t]);
}

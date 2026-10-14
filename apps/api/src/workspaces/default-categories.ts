import type { Tx } from '../database/database.module';
import { categories } from '../database/schema';

type Row = readonly [
  systemKey: string,
  kind: 'income' | 'expense',
  name: string,
  color: string,
  icon: string,
];

/** Seeded into every new workspace. `systemKey` lets the UI localize names until renamed. */
const TABLE: readonly Row[] = [
  ['groceries', 'expense', 'Groceries', '#16a34a', 'shopping-basket'],
  ['dining', 'expense', 'Dining', '#ea580c', 'utensils'],
  ['transport', 'expense', 'Transport', '#2563eb', 'bus'],
  ['housing', 'expense', 'Housing', '#7c3aed', 'house'],
  ['utilities', 'expense', 'Utilities', '#0891b2', 'plug'],
  ['health', 'expense', 'Health', '#dc2626', 'heart-pulse'],
  ['shopping', 'expense', 'Shopping', '#db2777', 'shopping-bag'],
  ['entertainment', 'expense', 'Entertainment', '#9333ea', 'clapperboard'],
  ['travel', 'expense', 'Travel', '#0284c7', 'plane'],
  ['education', 'expense', 'Education', '#4f46e5', 'graduation-cap'],
  ['kids', 'expense', 'Kids', '#f59e0b', 'baby'],
  ['gifts', 'expense', 'Gifts', '#e11d48', 'gift'],
  ['subscriptions', 'expense', 'Subscriptions', '#64748b', 'repeat'],
  ['other_expense', 'expense', 'Other', '#78716c', 'circle-ellipsis'],
  ['salary', 'income', 'Salary', '#15803d', 'briefcase'],
  ['freelance', 'income', 'Freelance', '#0d9488', 'laptop'],
  ['gifts_received', 'income', 'Gifts received', '#be185d', 'gift'],
  ['refunds', 'income', 'Refunds', '#0369a1', 'undo-2'],
  ['interest', 'income', 'Interest', '#a16207', 'piggy-bank'],
  ['other_income', 'income', 'Other', '#57534e', 'circle-ellipsis'],
];

export const DEFAULT_CATEGORIES = TABLE.map(([systemKey, kind, name, color, icon]) => ({
  systemKey,
  kind,
  name,
  color,
  icon,
}));

/** The caller's transaction must hold the ledger lock (`ledgerTransaction`). */
export async function seedDefaultCategories(tx: Tx, workspaceId: string): Promise<void> {
  await tx.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, workspaceId })));
}

import type { Tx } from '../database/database.module';
import { categories } from '../database/schema';

type Row = readonly [systemKey: string, kind: 'income' | 'expense', color: string, icon: string];

/** Seeded into every new workspace, unnamed: the UI shows each one by `systemKey` (ADR-012). */
const TABLE: readonly Row[] = [
  ['groceries', 'expense', '#16a34a', 'shopping-basket'],
  ['dining', 'expense', '#ea580c', 'utensils'],
  ['transport', 'expense', '#2563eb', 'bus'],
  ['housing', 'expense', '#7c3aed', 'house'],
  ['utilities', 'expense', '#0891b2', 'plug'],
  ['health', 'expense', '#dc2626', 'heart-pulse'],
  ['shopping', 'expense', '#db2777', 'shopping-bag'],
  ['entertainment', 'expense', '#9333ea', 'clapperboard'],
  ['travel', 'expense', '#0284c7', 'plane'],
  ['education', 'expense', '#4f46e5', 'graduation-cap'],
  ['kids', 'expense', '#f59e0b', 'baby'],
  ['gifts', 'expense', '#e11d48', 'gift'],
  ['subscriptions', 'expense', '#64748b', 'repeat'],
  ['other_expense', 'expense', '#78716c', 'circle-ellipsis'],
  ['salary', 'income', '#15803d', 'briefcase'],
  ['freelance', 'income', '#0d9488', 'laptop'],
  ['gifts_received', 'income', '#be185d', 'gift'],
  ['refunds', 'income', '#0369a1', 'undo-2'],
  ['interest', 'income', '#a16207', 'piggy-bank'],
  ['other_income', 'income', '#57534e', 'circle-ellipsis'],
];

export const DEFAULT_CATEGORIES = TABLE.map(([systemKey, kind, color, icon]) => ({
  systemKey,
  kind,
  color,
  icon,
}));

/** The caller's transaction must hold the ledger lock (`ledgerTransaction`). */
export async function seedDefaultCategories(tx: Tx, workspaceId: string): Promise<void> {
  await tx.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, workspaceId })));
}

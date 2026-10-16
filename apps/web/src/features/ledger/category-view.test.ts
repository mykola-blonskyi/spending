import { describe, expect, it } from 'vitest';
import type { Category } from '@data/sync';
import { categoryView, findDuplicateCategory } from './category-view';

const uk: Record<string, string> = { groceries: 'Продукти', salary: 'Зарплата' };
const t = (key: string) => uk[key] ?? key;
const stamp = { revision: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const category = (patch: Partial<Category>): Category => ({
  id: 'c-1',
  workspaceId: 'ws-1',
  name: null,
  kind: 'expense',
  color: '#16a34a',
  icon: 'tag',
  systemKey: 'groceries',
  archivedAt: null,
  ...stamp,
  ...patch,
});
const views = [
  category({}),
  category({ id: 'c-2', kind: 'income', systemKey: 'salary' }),
  category({ id: 'c-3', name: 'Їжа', systemKey: null, archivedAt: '2026-02-01T00:00:00Z' }),
  category({ id: 'c-4', name: 'Cafe', systemKey: null, workspaceId: 'ws-2' }),
].map((c) => categoryView(c, t as never));

const find = (name: string, patch: Partial<Parameters<typeof findDuplicateCategory>[1]> = {}) =>
  findDuplicateCategory(views, { name, workspaceId: 'ws-1', kind: 'expense', ...patch }, 'uk')?.id;

describe('findDuplicateCategory', () => {
  it('matches the localized name of an unnamed default, ignoring case and spaces', () => {
    expect(find('  продукти ')).toBe('c-1');
  });

  it('matches an archived custom name', () => {
    expect(find('ЇЖА')).toBe('c-3');
  });

  it('ignores other kinds, other workspaces and the category itself', () => {
    expect(find('Зарплата')).toBeUndefined();
    expect(find('Cafe')).toBeUndefined();
    expect(find('Продукти', { exceptId: 'c-1' })).toBeUndefined();
  });

  it('tells accents apart', () => {
    expect(find('Cafe', { workspaceId: 'ws-2' })).toBe('c-4');
    expect(find('Café', { workspaceId: 'ws-2' })).toBeUndefined();
  });
});

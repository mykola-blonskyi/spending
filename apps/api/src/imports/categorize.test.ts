import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../workspaces/default-categories';
import { type CategoryCatalog, categorize, KEYWORD_RULES, merchantKey } from './categorize';

const bySystemKey = new Map(
  DEFAULT_CATEGORIES.map((c) => [c.systemKey, { id: `cat-${c.systemKey}`, kind: c.kind }]),
);
const catalog = (learned: CategoryCatalog['learned'] = new Map()): CategoryCatalog => ({
  learned,
  bySystemKey,
});

describe('merchantKey', () => {
  it.each([
    ['COMPRA TARJ. 5489XXXXXXXX1234 MERCADONA VALENCIA 12/10/2026', 'mercadona valencia'],
    ['Pago con tarjeta en Café Pepe', 'cafe pepe'],
    ['RECIBO ENDESA ENERGIA S.A. REF 99812', 'endesa energia'],
    ['  CABIFY   *TRIP 1234  Madrid Centro Norte', 'cabify trip madrid'],
    ['****1234 2026-10-01', ''],
  ])('%s gives %j', (description, key) => {
    expect(merchantKey(description)).toBe(key);
  });

  it('ignores store numbers, so branches of one merchant share a key', () => {
    expect(merchantKey('MERCADONA 0423 VALENCIA')).toBe(merchantKey('Mercadona 1187 Valencia'));
  });
});

describe('categorize', () => {
  it.each([
    ['COMPRA TARJ 5489XXXX1234 MERCADONA VALENCIA', 'expense', 'cat-groceries'],
    ['LIDL SUPERMERCADOS 0042', 'expense', 'cat-groceries'],
    ['RENFE VIAJEROS', 'expense', 'cat-transport'],
    ['Netflix.com', 'expense', 'cat-subscriptions'],
    ['AMAZON PRIME*2K3', 'expense', 'cat-subscriptions'],
    ['AMAZON MKTPLACE', 'expense', 'cat-shopping'],
    ['UBER EATS MADRID', 'expense', 'cat-dining'],
    ['UBER TRIP', 'expense', 'cat-transport'],
    ['FARMACIA LDO GARCIA', 'expense', 'cat-health'],
    ['RECIBO IBERDROLA', 'expense', 'cat-utilities'],
    ['Bar Manolo', 'expense', 'cat-dining'],
    ['NOMINA OCTUBRE EMPRESA SL', 'income', 'cat-salary'],
    ['DEVOLUCION AMAZON', 'income', 'cat-refunds'],
  ] as const)('%s (%s) gives %s', (description, kind, category) => {
    expect(categorize(description, kind, catalog())).toBe(category);
  });

  it('matches whole words only', () => {
    expect(categorize('BARCELONA PARKING SL', 'expense', catalog())).toBe('cat-transport');
    expect(categorize('DIAGNOSTICO AUTO', 'expense', catalog())).toBeNull();
  });

  it('leaves unknown merchants and wrong kinds uncategorized', () => {
    expect(categorize('Ferreteria Lopez', 'expense', catalog())).toBeNull();
    expect(categorize('MERCADONA', 'income', catalog())).toBeNull();
    expect(categorize('NOMINA', 'expense', catalog())).toBeNull();
  });

  it('prefers a learned rule over a keyword rule', () => {
    const learned = new Map([['mercadona valencia', { id: 'cat-mine', kind: 'expense' as const }]]);
    expect(categorize('MERCADONA 0423 VALENCIA', 'expense', catalog(learned))).toBe('cat-mine');
    expect(categorize('MERCADONA MADRID', 'expense', catalog(learned))).toBe('cat-groceries');
  });

  it('skips a learned rule of the other kind', () => {
    const learned = new Map([['mercadona', { id: 'cat-income', kind: 'income' as const }]]);
    expect(categorize('Mercadona', 'expense', catalog(learned))).toBe('cat-groceries');
  });

  it('skips built-in rules whose default category is gone', () => {
    const withoutGroceries = new Map(bySystemKey);
    withoutGroceries.delete('groceries');
    expect(
      categorize('MERCADONA', 'expense', { learned: new Map(), bySystemKey: withoutGroceries }),
    ).toBeNull();
  });

  it('only names default categories that exist', () => {
    const keys = new Set(DEFAULT_CATEGORIES.map((c) => c.systemKey));
    expect(KEYWORD_RULES.map(([key]) => key).filter((key) => !keys.has(key))).toEqual([]);
  });
});

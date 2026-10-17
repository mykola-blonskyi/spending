import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../workspaces/default-categories';
import {
  bankCategoryKey,
  type CategoryCatalog,
  categorize,
  foldBankCategory,
  KEYWORD_RULES,
  mccSystemKey,
  merchantKey,
} from './categorize';

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

describe('bank category and MCC hints (BR-29)', () => {
  it.each([
    ['5411', 'groceries'],
    ['5499', 'groceries'],
    ['5812', 'dining'],
    ['5814', 'dining'],
    ['4111', 'transport'],
    ['4121', 'transport'],
    ['5541', 'transport'],
    ['4900', 'utilities'],
    ['4899', 'subscriptions'],
    ['5815', 'subscriptions'],
    ['5818', 'subscriptions'],
    ['5912', 'health'],
    ['8011', 'health'],
    ['8099', 'health'],
    ['5999', 'shopping'],
    ['4829', undefined],
    ['0000', undefined],
    ['', undefined],
  ])('MCC %s suggests %s', (mcc, systemKey) => {
    expect(mccSystemKey(mcc)).toBe(systemKey);
  });

  it('only names default categories that exist', () => {
    const keys = new Set(DEFAULT_CATEGORIES.map((c) => c.systemKey));
    for (let mcc = 0; mcc < 10000; mcc++) {
      const key = mccSystemKey(String(mcc).padStart(4, '0'));
      if (key) expect(keys.has(key), `${mcc} -> ${key}`).toBe(true);
    }
  });

  it('suggests a default from the bank category text', () => {
    const hints = { bankCategory: 'Комуналка та Інтернет' };
    expect(categorize('Київводоканал', 'expense', catalog(), hints)).toBe('cat-utilities');
    expect(categorize('Кав’ярня Зерно', 'expense', catalog(), { bankCategory: 'Кафе' })).toBe(
      'cat-dining',
    );
    expect(categorize('X', 'expense', catalog(), { bankCategory: 'Невідома' })).toBeNull();
  });

  it('applies the order: learned description, learned bank category, MCC, bank words, keywords', () => {
    const mine = (id: string) => ({ id, kind: 'expense' as const });
    const bank = bankCategoryKey(foldBankCategory('Комуналка та Інтернет'));
    const hints = { bankCategory: 'Комуналка та Інтернет', mcc: '5411' };
    const learned = new Map([[bank, mine('cat-bank-rule')]]);
    expect(categorize('Mercadona', 'expense', catalog(learned), hints)).toBe('cat-bank-rule');
    learned.set('mercadona', mine('cat-merchant-rule'));
    expect(categorize('Mercadona', 'expense', catalog(learned), hints)).toBe('cat-merchant-rule');
    expect(categorize('Mercadona', 'expense', catalog(), hints)).toBe('cat-groceries');
    expect(categorize('Lidl', 'expense', catalog(), { bankCategory: 'Кафе', mcc: '4900' })).toBe(
      'cat-utilities',
    );
    expect(categorize('Lidl', 'expense', catalog(), { bankCategory: 'Кафе' })).toBe('cat-dining');
    expect(categorize('Lidl', 'expense', catalog(), { bankCategory: 'Невідома' })).toBe(
      'cat-groceries',
    );
  });

  it('skips a hint whose category has the other kind', () => {
    expect(categorize('Return', 'income', catalog(), { mcc: '5411' })).toBeNull();
  });

  it('keeps bank-category keys apart from merchant keys', () => {
    expect(bankCategoryKey(foldBankCategory('Кафе'))).toBe('bank:кафе');
    expect(merchantKey('bank:кафе')).toBe('bank кафе');
  });
});

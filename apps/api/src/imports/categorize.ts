import type { EntryKind } from '../ledger/views';

/**
 * Built-in keyword rules (BR-29), by the `systemKey` of a default category. A keyword is one or
 * more whole tokens of the folded description. The longest matching keyword wins, so
 * "amazon prime" beats "amazon" and "uber eats" beats "uber".
 */
export const KEYWORD_RULES: readonly (readonly [systemKey: string, keywords: readonly string[]])[] =
  [
    [
      'groceries',
      [
        'mercadona',
        'carrefour',
        'lidl',
        'dia',
        'alcampo',
        'eroski',
        'aldi',
        'consum',
        'hipercor',
        'ahorramas',
        'caprabo',
        'bonpreu',
        'supermercado',
        'supermarket',
      ],
    ],
    [
      'transport',
      [
        'renfe',
        'metro',
        'cabify',
        'uber',
        'bolt',
        'taxi',
        'emt',
        'repsol',
        'cepsa',
        'galp',
        'shell',
        'gasolinera',
        'parking',
        'autopista',
      ],
    ],
    [
      'subscriptions',
      ['netflix', 'spotify', 'amazon prime', 'hbo', 'disney plus', 'youtube premium'],
    ],
    ['health', ['farmacia', 'pharmacy', 'clinica', 'hospital', 'dentista', 'optica']],
    [
      'utilities',
      [
        'endesa',
        'iberdrola',
        'naturgy',
        'holaluz',
        'vodafone',
        'movistar',
        'orange',
        'jazztel',
        'digi',
      ],
    ],
    [
      'dining',
      [
        'restaurante',
        'restaurant',
        'bar',
        'cafe',
        'cafeteria',
        'burger king',
        'mcdonalds',
        'telepizza',
        'glovo',
        'just eat',
        'uber eats',
      ],
    ],
    ['shopping', ['amazon', 'zara', 'el corte ingles', 'ikea', 'decathlon', 'primark']],
    ['travel', ['ryanair', 'vueling', 'iberia', 'booking', 'airbnb', 'hotel']],
    ['housing', ['alquiler', 'hipoteca', 'rent', 'mortgage']],
    ['salary', ['nomina', 'salary', 'payroll']],
    ['refunds', ['devolucion', 'refund']],
    ['interest', ['intereses', 'interest']],
  ];

/**
 * Built-in rules for the bank's own category text (PrivatBank), by default-category `systemKey`.
 * Keywords are whole tokens of the folded text, matched like `KEYWORD_RULES`.
 */
const BANK_CATEGORY_RULES: readonly (readonly [systemKey: string, keywords: readonly string[]])[] =
  [
    ['groceries', ['продукти', 'супермаркети']],
    ['dining', ['кафе', 'ресторани']],
    ['transport', ['транспорт', 'таксі', 'пальне', 'азс']],
    ['utilities', ['комуналка', 'комунальні', 'інтернет']],
    ['health', ['аптеки', 'медицина', "здоров'я"]],
    ['shopping', ['одяг', 'взуття', 'магазини']],
    ['entertainment', ['розваги']],
    ['travel', ['подорожі']],
    ['education', ['освіта']],
    ['kids', ['дитячі']],
    ['salary', ['зарплата']],
  ];

/** Card-scheme merchant category codes (monobank) by default category: [from, to, systemKey]. */
const MCC_RANGES: readonly (readonly [from: number, to: number, systemKey: string])[] = [
  [5411, 5411, 'groceries'],
  [5422, 5422, 'groceries'],
  [5441, 5441, 'groceries'],
  [5451, 5451, 'groceries'],
  [5462, 5462, 'groceries'],
  [5499, 5499, 'groceries'],
  [5811, 5814, 'dining'],
  [4111, 4112, 'transport'],
  [4121, 4121, 'transport'],
  [4131, 4131, 'transport'],
  [4789, 4789, 'transport'],
  [5541, 5542, 'transport'],
  [7523, 7523, 'transport'],
  [4900, 4900, 'utilities'],
  [4814, 4814, 'utilities'],
  [4899, 4899, 'subscriptions'],
  [5815, 5818, 'subscriptions'],
  [5912, 5912, 'health'],
  [8011, 8099, 'health'],
  [5311, 5311, 'shopping'],
  [5651, 5651, 'shopping'],
  [5691, 5691, 'shopping'],
  [5732, 5732, 'shopping'],
  [5999, 5999, 'shopping'],
  [3000, 3299, 'travel'],
  [4511, 4511, 'travel'],
  [7011, 7011, 'travel'],
  [7832, 7832, 'entertainment'],
  [7922, 7922, 'entertainment'],
  [7996, 7996, 'entertainment'],
  [8211, 8299, 'education'],
];

/** The default category an MCC suggests, or undefined. */
export function mccSystemKey(mcc: string): string | undefined {
  const code = Number(mcc);
  return MCC_RANGES.find(([from, to]) => code >= from && code <= to)?.[2];
}

/** Bank boilerplate that says nothing about the merchant. */
const STOPWORDS = new Set([
  'compra',
  'tarj',
  'tarjeta',
  'pago',
  'con',
  'en',
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'card',
  'purchase',
  'payment',
  'pos',
  'tpv',
  'cargo',
  'adeudo',
  'recibo',
  'ref',
  'contactless',
  'visa',
  'mastercard',
  'debito',
  'credito',
]);

const MERCHANT_KEY_TOKENS = 3;
const DATE = /\b\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g;

/**
 * Lowercase words without accents, card masks, dates or numbers ("COMPRA TARJ. 5489XXXX1234
 * Café Pepe 12/10" gives ["compra", "tarj", "cafe", "pepe"]). Asterisks separate tokens, and a
 * token with a digit goes whole, which removes masks, references and store numbers alike.
 */
export function words(description: string): string[] {
  return description
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(DATE, ' ')
    .split(/[\s*]+/)
    .filter((token) => !/\d/.test(token))
    .join(' ')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

/** The learned-rule key: the first meaningful words of the description, or '' when none. */
export function merchantKey(description: string): string {
  return words(description)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .slice(0, MERCHANT_KEY_TOKENS)
    .join(' ');
}

/** The bank category as matched: folded words, '' when none. */
export const foldBankCategory = (text: string) => words(text).join(' ');

/** The learned-rule key of a folded bank category; the prefix keeps it apart from merchant keys. */
export const bankCategoryKey = (folded: string) => `bank:${folded}`;

type CategoryRef = Readonly<{ id: string; kind: EntryKind }>;

/** What one workspace offers the categorizer: learned rules and its default categories. */
export type CategoryCatalog = Readonly<{
  learned: ReadonlyMap<string, CategoryRef>;
  bySystemKey: ReadonlyMap<string, CategoryRef>;
}>;

/** The bank's own category text and MCC for a row; neither is stored on the transaction. */
export type Hints = Readonly<{ bankCategory?: string; mcc?: string }>;

/** The longest keyword of `rules` found in the folded text whose category exists with this kind. */
function keywordMatch(
  text: string,
  rules: typeof KEYWORD_RULES,
  kind: EntryKind,
  catalog: CategoryCatalog,
): string | null {
  const padded = ` ${text} `;
  let best: { id: string; length: number } | null = null;
  for (const [systemKey, keywords] of rules) {
    const category = catalog.bySystemKey.get(systemKey);
    if (category?.kind !== kind) continue;
    for (const keyword of keywords) {
      const length = keyword.split(' ').length;
      if ((best === null || length > best.length) && padded.includes(` ${keyword} `)) {
        best = { id: category.id, length };
      }
    }
  }
  return best?.id ?? null;
}

const FOLDED_BANK_CATEGORY_RULES = BANK_CATEGORY_RULES.map(
  ([systemKey, keywords]) => [systemKey, keywords.map(foldBankCategory)] as const,
);

/**
 * BR-29: a learned rule on the description, a learned rule on the bank category, the MCC table,
 * the built-in bank category words, then built-in keywords on the description, else
 * uncategorized; kinds must match.
 */
export function categorize(
  description: string,
  kind: EntryKind,
  catalog: CategoryCatalog,
  hints: Hints = {},
): string | null {
  const learnedFor = (key: string) => {
    const learned = key === '' ? undefined : catalog.learned.get(key);
    return learned?.kind === kind ? learned.id : null;
  };
  const bankCategory = foldBankCategory(hints.bankCategory ?? '');
  const mccCategory = catalog.bySystemKey.get(mccSystemKey(hints.mcc ?? '') ?? '');
  return (
    learnedFor(merchantKey(description)) ??
    (bankCategory ? learnedFor(bankCategoryKey(bankCategory)) : null) ??
    (mccCategory?.kind === kind ? mccCategory.id : null) ??
    keywordMatch(bankCategory, FOLDED_BANK_CATEGORY_RULES, kind, catalog) ??
    keywordMatch(words(description).join(' '), KEYWORD_RULES, kind, catalog)
  );
}

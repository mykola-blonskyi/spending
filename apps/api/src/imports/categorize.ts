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
function words(description: string): string[] {
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

export type CategoryRef = Readonly<{ id: string; kind: EntryKind }>;

/** What one workspace offers the categorizer: learned rules and its default categories. */
export type CategoryCatalog = Readonly<{
  learned: ReadonlyMap<string, CategoryRef>;
  bySystemKey: ReadonlyMap<string, CategoryRef>;
}>;

/** BR-29: a learned rule, then a built-in keyword rule, else uncategorized; kinds must match. */
export function categorize(
  description: string,
  kind: EntryKind,
  catalog: CategoryCatalog,
): string | null {
  const learned = catalog.learned.get(merchantKey(description));
  if (learned?.kind === kind) return learned.id;
  const text = ` ${words(description).join(' ')} `;
  let best: { id: string; length: number } | null = null;
  for (const [systemKey, keywords] of KEYWORD_RULES) {
    const category = catalog.bySystemKey.get(systemKey);
    if (category?.kind !== kind) continue;
    for (const keyword of keywords) {
      const length = keyword.split(' ').length;
      if ((best === null || length > best.length) && text.includes(` ${keyword} `)) {
        best = { id: category.id, length };
      }
    }
  }
  return best?.id ?? null;
}

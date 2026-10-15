import { describe, expect, it } from 'vitest';
import { CATALOGS, detectLocale, LOCALES } from './locales';

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
  );
}

// A plural branch such as `one {day}` is text, not an argument named `day`.
const ICU_ARGUMENT = /(?<!(?:zero|one|two|few|many|other|=\d+)\s*)\{(\w+)[,}]/g;
const argumentsOf = (message: string) =>
  [...new Set([...message.matchAll(ICU_ARGUMENT)].map((match) => match[1]))].sort();

const reference = new Map(leaves(CATALOGS.en));

describe.each(LOCALES)('%s catalog', (locale) => {
  const entries = leaves(CATALOGS[locale]);

  it('has exactly the English keys', () => {
    expect(entries.map(([key]) => key).sort()).toEqual([...reference.keys()].sort());
  });

  it('has no empty messages', () => {
    expect(entries.filter(([, message]) => message.trim() === '')).toEqual([]);
  });

  it('keeps the same ICU arguments as English', () => {
    for (const [key, message] of entries) {
      expect([key, argumentsOf(message)]).toEqual([key, argumentsOf(reference.get(key) ?? '')]);
    }
  });
});

describe('detectLocale', () => {
  it('prefers a saved choice', () => {
    expect(detectLocale('ru', ['uk-UA'])).toBe('ru');
  });

  it('falls back to the first supported browser language', () => {
    expect(detectLocale(null, ['de-DE', 'uk-UA', 'en'])).toBe('uk');
    expect(detectLocale('xx', ['es-419'])).toBe('es');
  });

  it('defaults to English', () => {
    expect(detectLocale(null, ['de', 'fr'])).toBe('en');
    expect(detectLocale(null, [])).toBe('en');
  });
});

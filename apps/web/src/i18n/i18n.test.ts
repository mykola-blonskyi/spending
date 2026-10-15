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

function pluralBranches(message: string): string[][] {
  const found: string[][] = [];
  for (const match of message.matchAll(/\{\w+,\s*plural,/g)) {
    const branches: string[] = [];
    let index = match.index + match[0].length;
    while (index < message.length) {
      const selector = /^\s*([^\s{}]+)\s*\{/.exec(message.slice(index));
      if (!selector) break;
      const [skipped, name = ''] = selector;
      branches.push(name);
      index += skipped.length;
      for (let depth = 1; depth > 0; index++) {
        if (message[index] === '{') depth++;
        else if (message[index] === '}') depth--;
      }
    }
    found.push(branches);
  }
  return found;
}

// A plural that inflects must name every form whole numbers take, or `=n` them; a missing form
// silently falls back to `other`.
function missingForms(locale: string, branches: string[]): string[] {
  if (branches.every((branch) => branch === 'other' || branch.startsWith('='))) return [];
  const rules = new Intl.PluralRules(locale);
  const missing = Array.from({ length: 1000 }, (_, n) => n)
    .filter((n) => !branches.includes(`=${n}`))
    .map((n) => rules.select(n))
    .filter((form) => !branches.includes(form));
  return [...new Set(missing)];
}

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

  it('gives every plural the forms the language needs', () => {
    const missing = entries.flatMap(([key, message]) =>
      pluralBranches(message).flatMap((branches) =>
        missingForms(locale, branches).map((form) => `${key}: ${form}`),
      ),
    );
    expect(missing).toEqual([]);
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

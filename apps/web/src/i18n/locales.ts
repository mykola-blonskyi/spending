import { en, type Messages } from './messages/en';
import { es } from './messages/es';
import { ru } from './messages/ru';
import { uk } from './messages/uk';

export const LOCALES = ['en', 'uk', 'ru', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'spending.locale';

export const CATALOGS: Record<Locale, Messages> = { en, uk, ru, es };

/** Each language is named in itself, so people can find theirs whatever is active. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  uk: 'Українська',
  ru: 'Русский',
  es: 'Español',
};

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

function fromLanguageTag(tag: string): Locale | undefined {
  const language = tag.toLowerCase().split('-')[0];
  return isLocale(language) ? language : undefined;
}

export function detectLocale(saved: string | null, languages: readonly string[]): Locale {
  if (isLocale(saved)) return saved;
  for (const tag of languages) {
    const locale = fromLanguageTag(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function readSavedLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable; the choice then lasts until reload.
  }
}

export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

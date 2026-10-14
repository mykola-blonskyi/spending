import type { Messages } from './messages/en';
import type { Locale } from './locales';

declare module 'use-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}

export { useLocaleStore } from './locale-store';
export {
  DEFAULT_LOCALE,
  detectLocale,
  isLocale,
  LOCALE_NAMES,
  LOCALE_STORAGE_KEY,
  LOCALES,
  type Locale,
} from './locales';
export type { Messages } from './messages/en';
export { I18nProvider } from './provider';
export { useTranslations } from 'use-intl';

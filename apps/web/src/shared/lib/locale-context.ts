import { createContext, use } from 'react';

/**
 * Words the shared components need. `shared` may not import `i18n`, so the app fills this
 * from the active catalog. Counts arrive already pluralized through the functions.
 */
export type SharedStrings = {
  close: string;
  retry: string;
  cancel: string;
  loading: string;
  more: string;
  moreTitle: string;
  skipToContent: string;
  mainNavigation: string;
  offlineTitle: string;
  offlineDescription: string;
  synced: string;
  syncing: string;
  syncFailed: string;
  syncPending: (count: number) => string;
  syncConflict: (count: number) => string;
  negativeAmount: (amount: string) => string;
  typeToConfirm: (phrase: string) => string;
  confirmPhraseLabel: string;
};

export type SharedLocale = { locale: string; strings: SharedStrings };

const englishStrings: SharedStrings = {
  close: 'Close',
  retry: 'Try again',
  cancel: 'Cancel',
  loading: 'Loading…',
  more: 'More',
  moreTitle: 'All sections',
  skipToContent: 'Skip to content',
  mainNavigation: 'Main navigation',
  offlineTitle: 'You are offline',
  offlineDescription: 'Changes are saved on this device and will sync when you reconnect.',
  synced: 'Up to date',
  syncing: 'Syncing…',
  syncFailed: 'Sync failed',
  syncPending: (count) => `${count} pending`,
  syncConflict: (count) => `${count} conflicts`,
  negativeAmount: (amount) => `minus ${amount}`,
  typeToConfirm: (phrase) => `To confirm, type ${phrase} below.`,
  confirmPhraseLabel: 'Confirmation phrase',
};

const LocaleContext = createContext<SharedLocale>({ locale: 'en', strings: englishStrings });

export const SharedLocaleProvider = LocaleContext;

export function useSharedLocale(): SharedLocale {
  return use(LocaleContext);
}

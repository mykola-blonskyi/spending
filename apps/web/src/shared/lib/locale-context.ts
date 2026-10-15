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
  syncRetrying: string;
  syncAuthRequired: string;
  syncFailed: (count: number) => string;
  syncPending: (count: number) => string;
  syncOffline: (count: number) => string;
  syncConflict: (count: number) => string;
  negativeAmount: (amount: string) => string;
  typeToConfirm: (phrase: string) => string;
  confirmPhraseLabel: string;
  /** The catalog line for an `ApiError` code. */
  apiError: (code: string) => string;
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
  syncRetrying: 'Retrying…',
  syncAuthRequired: 'Sign in to sync',
  syncFailed: (count) => `${count} failed`,
  syncPending: (count) => `${count} pending`,
  syncOffline: (count) => (count > 0 ? `Offline, ${count} pending` : 'Offline'),
  syncConflict: (count) => `${count} conflicts`,
  negativeAmount: (amount) => `minus ${amount}`,
  typeToConfirm: (phrase) => `To confirm, type ${phrase} below.`,
  confirmPhraseLabel: 'Confirmation phrase',
  apiError: () => 'Something went wrong. Try again in a moment.',
};

const LocaleContext = createContext<SharedLocale>({ locale: 'en', strings: englishStrings });

export const SharedLocaleProvider = LocaleContext;

export function useSharedLocale(): SharedLocale {
  return use(LocaleContext);
}

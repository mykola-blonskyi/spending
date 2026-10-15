import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ApiErrorCode } from '@data/api-error';
import { I18nProvider, useLocaleStore, useTranslations } from '@i18n/index';
import { type SharedLocale, SharedLocaleProvider } from '@shared/lib/locale-context';
import { ThemeProvider } from '@shared/theme';
import { Toaster } from '@shared/ui/sonner';
import { TooltipProvider } from '@shared/ui/tooltip';

function SharedLocaleBridge({ locale, children }: { locale: string; children: React.ReactNode }) {
  const t = useTranslations();
  const value = useMemo<SharedLocale>(
    () => ({
      locale,
      strings: {
        close: t('actions.close'),
        retry: t('actions.retry'),
        cancel: t('actions.cancel'),
        loading: t('states.loading'),
        more: t('nav.more'),
        moreTitle: t('nav.moreTitle'),
        skipToContent: t('nav.skipToContent'),
        mainNavigation: t('nav.label'),
        offlineTitle: t('states.offline.title'),
        offlineDescription: t('states.offline.description'),
        synced: t('states.sync.synced'),
        syncing: t('states.sync.syncing'),
        syncRetrying: t('states.sync.retrying'),
        syncAuthRequired: t('states.sync.authRequired'),
        syncFailed: (count) => t('states.sync.failedShort', { count }),
        syncPending: (count) => t('states.sync.pendingShort', { count }),
        syncOffline: (count) => t('states.sync.offlineShort', { count }),
        syncConflict: (count) => t('states.sync.conflictShort', { count }),
        negativeAmount: (amount) => t('money.negative', { amount }),
        typeToConfirm: (phrase) => t('confirm.typeToConfirm', { phrase }),
        confirmPhraseLabel: t('confirm.phraseLabel'),
        apiError: (code) => t(`errors.${code as ApiErrorCode}`),
      },
    }),
    [locale, t],
  );
  return <SharedLocaleProvider value={value}>{children}</SharedLocaleProvider>;
}

export function AppProviders({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: React.ReactNode;
}) {
  const locale = useLocaleStore((state) => state.locale);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider locale={locale}>
          <SharedLocaleBridge locale={locale}>
            <TooltipProvider delayDuration={400}>
              {children}
              <Toaster position="top-center" />
            </TooltipProvider>
          </SharedLocaleBridge>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

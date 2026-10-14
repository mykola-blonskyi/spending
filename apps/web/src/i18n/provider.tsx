import { useEffect } from 'react';
import { IntlProvider } from 'use-intl';
import { CATALOGS, type Locale } from './locales';

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <IntlProvider locale={locale} messages={CATALOGS[locale]} timeZone={timeZone}>
      {children}
    </IntlProvider>
  );
}

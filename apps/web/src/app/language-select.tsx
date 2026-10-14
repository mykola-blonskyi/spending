import { Languages } from 'lucide-react';
import { isLocale, LOCALE_NAMES, LOCALES, useLocaleStore, useTranslations } from '@i18n/index';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';

export function LanguageSelect({ compact = false, id }: { compact?: boolean; id?: string }) {
  const t = useTranslations('settings.language');
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);

  return (
    <Select value={locale} onValueChange={(value) => isLocale(value) && setLocale(value)}>
      <SelectTrigger
        id={id}
        aria-label={compact ? t('label') : undefined}
        className={compact ? 'h-9 border-transparent shadow-none hover:bg-muted' : 'w-full sm:w-48'}
      >
        {compact && <Languages aria-hidden />}
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {LOCALES.map((option) => (
          <SelectItem key={option} value={option} lang={option}>
            {LOCALE_NAMES[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

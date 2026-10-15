import { Languages } from 'lucide-react';
import {
  isLocale,
  type Locale,
  LOCALE_NAMES,
  LOCALES,
  useLocaleStore,
  useTranslations,
} from '@i18n/index';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';

/** Changes the device language unless `onValueChange` takes over (signed in, it saves to the profile). */
export function LanguageSelect({
  compact = false,
  id,
  onValueChange,
}: {
  compact?: boolean;
  id?: string;
  onValueChange?: (locale: Locale) => void;
}) {
  const t = useTranslations('settings.language');
  const locale = useLocaleStore((state) => state.locale);
  const setDeviceLocale = useLocaleStore((state) => state.setLocale);
  const setLocale = onValueChange ?? setDeviceLocale;

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

import { useMemo } from 'react';
import { useTranslations } from '@i18n/index';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { timeZoneOptions } from './time-zones';

export function TimezoneSelect({
  id,
  value,
  locale,
  onValueChange,
}: {
  id?: string;
  value: string;
  locale: string;
  onValueChange: (zone: string) => void;
}) {
  const t = useTranslations('settings.timezone');
  const { suggested, others } = useMemo(() => timeZoneOptions(value, locale), [value, locale]);

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className="w-full sm:w-72">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="max-h-80">
        <SelectGroup>
          <SelectLabel>{t('suggested')}</SelectLabel>
          <SelectItem value={suggested.id}>{suggested.label}</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>{t('all')}</SelectLabel>
          {others.map((zone) => (
            <SelectItem key={zone.id} value={zone.id}>
              {zone.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

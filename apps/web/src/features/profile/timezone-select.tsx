import { useMemo, useState } from 'react';
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
  const [open, setOpen] = useState(false);
  // Closed, only the chosen zone renders (it feeds the trigger's label): the ~400 others made
  // every settings render several times slower.
  const shown = open ? others : others.filter((zone) => zone.id === value);

  return (
    <Select value={value} onValueChange={onValueChange} open={open} onOpenChange={setOpen}>
      <SelectTrigger id={id} className="w-full @xl/main:w-72">
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
          {shown.map((zone) => (
            <SelectItem key={zone.id} value={zone.id}>
              {zone.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

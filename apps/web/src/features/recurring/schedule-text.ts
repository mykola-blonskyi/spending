import type { useTranslations } from '@i18n/index';
import { parseDateOnly } from '@shared/format';
import type { Rule } from './rules';

type Translator = ReturnType<typeof useTranslations<'recurring'>>;

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** "Every month on the 31st" plus the BR-23 clamp: days from the 29th on, and Feb 29 yearly. */
export function scheduleWords(
  rule: Pick<Rule, 'frequency' | 'interval' | 'startsOn'>,
  t: Translator,
  locale: string,
): string {
  const { frequency, interval, startsOn } = rule;
  const day = Number(startsOn.slice(8, 10));
  const withNote = (every: string, note: string | null) =>
    note ? t('scheduleNote', { every, note }) : every;
  switch (frequency) {
    case 'daily':
      return t('frequency.daily', { interval });
    case 'weekly':
      return t('frequency.weekly', {
        interval,
        weekday: t(`weekday.${WEEKDAYS[parseDateOnly(startsOn).getDay()] ?? 'sun'}`),
      });
    case 'monthly':
      return withNote(t('frequency.monthly', { interval, day }), day > 28 ? t('monthClamp') : null);
    case 'yearly': {
      const date = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(
        parseDateOnly(startsOn),
      );
      return withNote(
        t('frequency.yearly', { interval, date }),
        startsOn.slice(5) === '02-29' ? t('leapClamp') : null,
      );
    }
  }
}

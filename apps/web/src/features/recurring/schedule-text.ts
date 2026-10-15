import type { useTranslations } from '@i18n/index';
import { parseDateOnly } from '@shared/format';
import type { Rule } from './rules';

export type Translator = ReturnType<typeof useTranslations<'recurring'>>;
export type ScheduleWords = { every: string; clampNote: string | null };

/** "Every month on the 31st" plus the BR-23 clamp: days from the 29th on, and Feb 29 yearly. */
export function scheduleWords(
  rule: Pick<Rule, 'frequency' | 'interval' | 'startsOn'>,
  t: Translator,
  locale: string,
): ScheduleWords {
  const { frequency, interval, startsOn } = rule;
  const day = Number(startsOn.slice(8, 10));
  switch (frequency) {
    case 'daily':
    case 'weekly':
      return { every: t(`frequency.${frequency}`, { interval }), clampNote: null };
    case 'monthly':
      return {
        every: t('frequency.monthly', { interval, day }),
        clampNote: day > 28 ? t('monthClamp') : null,
      };
    case 'yearly': {
      const date = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(
        parseDateOnly(startsOn),
      );
      return {
        every: t('frequency.yearly', { interval, date }),
        clampNote: startsOn.slice(5) === '02-29' ? t('leapClamp') : null,
      };
    }
  }
}

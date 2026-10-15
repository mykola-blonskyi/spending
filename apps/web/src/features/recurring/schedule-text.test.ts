import { createTranslator } from 'use-intl';
import { describe, expect, it } from 'vitest';
import { CATALOGS, type Locale } from '@i18n/locales';
import type { Rule } from './rules';
import { scheduleWords } from './schedule-text';

const words = (
  locale: Locale,
  frequency: Rule['frequency'],
  interval: number,
  startsOn: string,
) => {
  const t = createTranslator({ locale, messages: CATALOGS[locale], namespace: 'recurring' });
  return scheduleWords({ frequency, interval, startsOn }, t, locale);
};

describe('scheduleWords', () => {
  it('reads monthly rules with an ordinal day and the clamp from the 29th on', () => {
    expect(words('en', 'monthly', 1, '2026-01-01')).toBe('Every month on the 1st');
    expect(words('en', 'monthly', 1, '2026-01-22')).toBe('Every month on the 22nd');
    expect(words('en', 'monthly', 3, '2026-01-28')).toBe('Every 3 months on the 28th');
    expect(words('en', 'monthly', 1, '2026-01-31')).toBe(
      'Every month on the 31st, or the last day of shorter months',
    );
    expect(words('ru', 'monthly', 1, '2026-01-31')).toBe(
      'Каждый месяц 31-го или в последний день более короткого месяца',
    );
    expect(words('uk', 'monthly', 2, '2026-01-29')).toBe(
      'Кожні 2 місяці 29-го або в останній день коротшого місяця',
    );
    expect(words('es', 'monthly', 1, '2026-01-30')).toBe(
      'Cada mes el día 30 o el último día de los meses más cortos',
    );
  });

  it('declines the interval in Slavic languages', () => {
    expect(words('ru', 'daily', 1, '2026-01-01')).toBe('Каждый день');
    expect(words('ru', 'daily', 5, '2026-01-01')).toBe('Каждые 5 дней');
    expect(words('uk', 'weekly', 2, '2026-01-01')).toBe('Кожні 2 тижні в четвер');
    expect(words('uk', 'weekly', 21, '2026-01-01')).toBe('Кожен 21 тиждень в четвер');
  });

  it('names the weekday of weekly rules after the start date', () => {
    expect(words('en', 'weekly', 1, '2026-01-05')).toBe('Every week on Monday');
    expect(words('en', 'weekly', 2, '2026-01-11')).toBe('Every 2 weeks on Sunday');
    expect(words('ru', 'weekly', 1, '2026-01-06')).toBe('Каждую неделю во вторник');
    expect(words('ru', 'weekly', 1, '2026-01-07')).toBe('Каждую неделю в среду');
    expect(words('uk', 'weekly', 1, '2026-01-09')).toBe('Щотижня в п’ятницю');
    expect(words('es', 'weekly', 3, '2026-01-10')).toBe('Cada 3 semanas el sábado');
  });

  it('names the day and month of yearly rules', () => {
    expect(words('en', 'yearly', 1, '2026-03-15')).toBe('Every year on March 15');
    expect(words('ru', 'yearly', 1, '2026-03-15')).toBe('Каждый год 15 марта');
    expect(words('es', 'yearly', 2, '2026-03-15')).toBe('Cada 2 años el 15 de marzo');
    expect(words('en', 'yearly', 1, '2024-02-29')).toBe(
      'Every year on February 29, or February 28 in other years',
    );
  });
});

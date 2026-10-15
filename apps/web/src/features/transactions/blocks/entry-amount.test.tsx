import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { TransactionEntry } from '@data/sync';
import { localRow } from '@data/sync/fixtures';
import { I18nProvider } from '@i18n/index';
import type { Locale } from '@i18n/locales';
import { formatDate, formatMoney } from '@shared/format';
import { SharedLocaleProvider, useSharedLocale } from '@shared/lib/locale-context';
import { summarize, toEntryRow } from '../history-model';
import { ConversionNote, EntryAmount } from './entry-amount';
import { TotalsLine } from './totals-line';

const fx = { rate: '1.0850', rateDate: '2026-10-14', source: 'ecb' };
const row = (patch: Partial<TransactionEntry>) =>
  toEntryRow(
    {
      ...localRow(),
      scope: 'personal',
      baseAmountMinor: null,
      fx: null,
      sync: { state: 'synced' },
      ...patch,
    },
    { categories: new Map(), accounts: new Map(), dayLabel: String, uncategorized: '' },
  );
const usd = row({ id: 'usd', currency: 'USD', amountMinor: 1085, baseAmountMinor: 1000, fx });
const chf = row({ id: 'chf', currency: 'CHF', amountMinor: 500 });

function WithLocale({ locale, children }: { locale: string; children: ReactNode }) {
  const shared = useSharedLocale();
  return <SharedLocaleProvider value={{ ...shared, locale }}>{children}</SharedLocaleProvider>;
}

/** Matches visible text as Intl formats it, with its no-break spaces. */
const exact = (text: string) =>
  screen.getByText(text, { normalizer: (value) => value, ignore: '.sr-only, script, style' });

function renderIn(locale: Locale, ui: ReactNode) {
  return render(
    <I18nProvider locale={locale}>
      <WithLocale locale={locale}>{ui}</WithLocale>
    </I18nProvider>,
  );
}

type Expected = {
  eur: string;
  details: string;
  chf: string;
  unavailable: string;
  notConverted: string;
  spent: string;
};

const nbsp = ' ';
const expected: Record<Locale, Expected> = {
  en: {
    eur: '-€10.00',
    details: '$10.85 · 1.0850 · Oct 14, 2026 · ECB',
    chf: `-CHF${nbsp}5.00`,
    unavailable: 'Conversion unavailable',
    notConverted: 'Not converted',
    spent: '€10.00',
  },
  uk: {
    eur: `-10,00${nbsp}EUR`,
    details: `10,85${nbsp}USD · 1,0850 · 14 жовт. 2026 р. · ECB`,
    chf: `-5,00${nbsp}CHF`,
    unavailable: 'Конвертація недоступна',
    notConverted: 'Не конвертовано',
    spent: `10,00${nbsp}EUR`,
  },
  ru: {
    eur: formatMoney(-1000, 'EUR', 'ru'),
    details: `${formatMoney(1085, 'USD', 'ru')} · 1,0850 · ${formatDate('2026-10-14', 'ru')} · ECB`,
    chf: formatMoney(-500, 'CHF', 'ru'),
    unavailable: 'Конвертация недоступна',
    notConverted: 'Не конвертировано',
    spent: formatMoney(1000, 'EUR', 'ru'),
  },
  es: {
    eur: formatMoney(-1000, 'EUR', 'es'),
    details: `${formatMoney(1085, 'USD', 'es')} · 1,0850 · ${formatDate('2026-10-14', 'es')} · ECB`,
    chf: formatMoney(-500, 'CHF', 'es'),
    unavailable: 'Conversión no disponible',
    notConverted: 'Sin convertir',
    spent: formatMoney(1000, 'EUR', 'es'),
  },
};

describe.each(Object.entries(expected) as [Locale, Expected][])(
  'conversion in %s',
  (locale, want) => {
    it('shows the EUR amount first, then the original amount with rate, date and source', () => {
      const { container } = renderIn(locale, <EntryAmount row={usd} />);
      expect(exact(want.eur)).toBeInTheDocument();
      expect(container.textContent).toContain(want.details);
    });

    it('marks an entry without a rate and keeps its original amount', () => {
      renderIn(locale, <EntryAmount row={chf} />);
      expect(exact(want.chf)).toBeInTheDocument();
      expect(exact(want.unavailable)).toBeInTheDocument();
    });

    it('totals EUR and lists the unconverted currency on its own line', () => {
      renderIn(locale, <TotalsLine totals={summarize([usd, chf])} />);
      expect(exact(want.spent)).toBeInTheDocument();
      const line = exact(want.notConverted).parentElement!.textContent;
      expect(line).toContain(want.chf.replace('-', ''));
      expect(line).not.toContain(want.spent);
    });
  },
);

describe('ConversionNote', () => {
  it('says how a stored entry was converted', () => {
    renderIn('en', <ConversionNote conversion={usd.conversion} />);
    expect(
      screen.getByText('Converted to €10.00 at 1.0850 (ECB, Oct 14, 2026)'),
    ).toBeInTheDocument();
  });

  it('says nothing for EUR or an edited amount', () => {
    const { container } = renderIn('en', <ConversionNote conversion={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

import { AlertCircle } from 'lucide-react';
import { useTranslations } from '@i18n/index';
import { MoneyText } from '@shared/components';
import { formatMoney } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { type Conversion, type EntryRow, fxLabels } from '../history-model';

function ConversionPending({ className }: { className?: string }) {
  const t = useTranslations('history');
  return (
    <span className={cn('text-xs whitespace-nowrap text-muted-foreground', className)}>
      {t('conversionPending')}
    </span>
  );
}

/** Says an entry has no EUR amount yet; the title explains why. */
export function ConversionUnavailable({ className }: { className?: string }) {
  const t = useTranslations('history');
  return (
    <span
      title={t('conversionUnavailableHint')}
      className={cn(
        'inline-flex items-center gap-1 text-xs whitespace-nowrap text-warning-foreground',
        className,
      )}
    >
      <AlertCircle aria-hidden className="size-3.5 shrink-0" />
      {t('conversionUnavailable')}
    </span>
  );
}

/**
 * A history row's amount: EUR first (BR-15), then the original amount with the rate, or the
 * original amount with the "conversion unavailable" marker.
 */
export function EntryAmount({
  row,
  className,
  secondaryClassName,
  align = 'end',
  colored = true,
}: {
  row: EntryRow;
  /** Typography of the primary amount. */
  className?: string;
  secondaryClassName?: string;
  align?: 'end' | 'start';
  colored?: boolean;
}) {
  const t = useTranslations('history');
  const { locale } = useSharedLocale();
  const { conversion } = row;
  const sign = row.kind === 'expense' ? -1 : 1;
  const converted = conversion.state === 'converted';
  const fx = converted ? fxLabels(conversion.fx, locale, t('sourceEcb')) : null;
  return (
    <span
      className={cn(
        'flex shrink-0 flex-col gap-0.5',
        align === 'end' ? 'items-end text-right' : 'items-start',
      )}
    >
      <MoneyText
        amountMinor={sign * (converted ? conversion.baseAmountMinor : row.amountMinor)}
        currency={converted ? 'EUR' : row.currency}
        colored={colored}
        className={className}
      />
      {fx && (
        <span
          className={cn(
            'text-xs whitespace-nowrap text-muted-foreground tabular',
            secondaryClassName,
          )}
        >
          {formatMoney(row.amountMinor, row.currency, locale)} · {fx.rate}
          {/* A narrow list keeps the rate date and source for screen readers only. */}
          <span className="@max-md/history:sr-only">
            {' '}
            · {fx.date} · {fx.source}
          </span>
        </span>
      )}
      {conversion.state === 'pending' && <ConversionPending className={secondaryClassName} />}
      {conversion.state === 'unavailable' && (
        <ConversionUnavailable className={secondaryClassName} />
      )}
    </span>
  );
}

/** Under the amount while editing a stored non-EUR entry: how it was converted, read-only. */
export function ConversionNote({
  conversion,
  className,
}: {
  conversion: Conversion | null;
  className?: string;
}) {
  const t = useTranslations('history');
  const { locale } = useSharedLocale();
  if (!conversion || conversion.state === 'same') return null;
  if (conversion.state === 'pending') return <ConversionPending className={className} />;
  if (conversion.state === 'unavailable') {
    return (
      <p className={cn('flex flex-col gap-0.5 text-xs text-muted-foreground', className)}>
        <ConversionUnavailable />
        <span>{t('conversionUnavailableHint')}</span>
      </p>
    );
  }
  return (
    <p className={cn('text-xs text-muted-foreground tabular', className)}>
      {t('convertedTo', {
        amount: formatMoney(conversion.baseAmountMinor, 'EUR', locale),
        ...fxLabels(conversion.fx, locale, t('sourceEcb')),
      })}
    </p>
  );
}

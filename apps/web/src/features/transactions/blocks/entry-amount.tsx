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
function ConversionUnavailable({
  className,
  labelClassName,
}: {
  className?: string;
  labelClassName?: string;
}) {
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
      <span className={labelClassName}>{t('conversionUnavailable')}</span>
    </span>
  );
}

/**
 * A history row's amount: EUR first (BR-15), then the original amount with the rate, or the
 * original amount with the "conversion unavailable" marker. A whole transfer shows what left and,
 * when it differs, what arrived, unsigned: it is neither income nor spending (BR-37).
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
  const { conversion, transfer } = row;
  const column = cn(
    'flex shrink-0 flex-col gap-0.5',
    align === 'end' ? 'items-end text-right' : 'items-start',
  );
  if (transfer?.view === 'whole') {
    const { into } = transfer;
    const differs =
      into && (into.currency !== row.currency || into.amountMinor !== row.amountMinor);
    return (
      <span className={column}>
        <MoneyText amountMinor={row.amountMinor} currency={row.currency} className={className} />
        {differs && (
          <span
            className={cn(
              'text-xs whitespace-nowrap text-muted-foreground tabular',
              secondaryClassName,
            )}
          >
            → {formatMoney(into.amountMinor, into.currency, locale)}
          </span>
        )}
      </span>
    );
  }
  const sign = row.kind === 'expense' ? -1 : 1;
  const converted = conversion.state === 'converted';
  const fx = converted ? fxLabels(conversion.fx, locale, t('sourceEcb')) : null;
  return (
    <span className={column}>
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
        <ConversionUnavailable
          className={secondaryClassName}
          labelClassName="@max-md/history:sr-only"
        />
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
      <p className={cn('text-xs text-muted-foreground', className)}>
        <ConversionUnavailable />
        <span className="mt-0.5 block">{t('conversionUnavailableHint')}</span>
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

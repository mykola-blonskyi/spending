import { formatMoney, type MoneyFormatOptions } from '@shared/format';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';

type MoneyTextProps = {
  /** Signed integer minor units: negative is money out, positive is money in. */
  amountMinor: number | bigint;
  currency: string;
  signDisplay?: MoneyFormatOptions['signDisplay'];
  /** Colors money in as income and money out as expense. */
  colored?: boolean;
  className?: string;
};

export function MoneyText({
  amountMinor,
  currency,
  signDisplay = 'auto',
  colored = false,
  className,
}: MoneyTextProps) {
  const { locale, strings } = useSharedLocale();
  const negative = amountMinor < 0;
  const visible = formatMoney(amountMinor, currency, locale, { signDisplay });
  const spoken =
    negative && signDisplay !== 'never'
      ? strings.negativeAmount(formatMoney(amountMinor, currency, locale, { signDisplay: 'never' }))
      : visible;

  return (
    <span
      data-sign={negative ? 'negative' : amountMinor > 0 ? 'positive' : 'zero'}
      className={cn(
        'tabular whitespace-nowrap',
        colored && negative && 'text-expense',
        colored && amountMinor > 0 && 'text-income',
        className,
      )}
    >
      <span aria-hidden>{visible}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

const cache = new Map<string, Intl.NumberFormat>();

export function numberFormat(locale: string, options: Intl.NumberFormatOptions = {}) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    cache.set(key, format);
  }
  return format;
}

export function formatNumber(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  return numberFormat(locale, options).format(value);
}

/** `ratio` is a fraction: 0.25 renders as 25 %. */
export function formatPercent(
  ratio: number,
  locale: string,
  options: {
    maximumFractionDigits?: number;
    signDisplay?: Intl.NumberFormatOptions['signDisplay'];
  } = {},
): string {
  return numberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: options.maximumFractionDigits ?? 0,
    signDisplay: options.signDisplay,
  }).format(ratio);
}

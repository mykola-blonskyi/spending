type Zone = { id: string; label: string };

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function offset(zone: string, locale: string, now: Date): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName');
  return parts?.value ?? '';
}

function zoneLabel(zone: string, locale: string, now: Date): string {
  return `${zone.replaceAll('_', ' ').replaceAll('/', ' / ')} (${offset(zone, locale, now)})`;
}

/** Every zone the browser knows, plus the current value in case the runtime names it differently. */
export function timeZoneOptions(current: string, locale: string, now = new Date()) {
  const ids = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC', current]);
  const suggested = browserTimeZone();
  const toZone = (id: string): Zone => ({ id, label: zoneLabel(id, locale, now) });
  return {
    suggested: toZone(suggested),
    others: [...ids]
      .filter((id) => id !== suggested)
      .sort()
      .map(toZone),
  };
}

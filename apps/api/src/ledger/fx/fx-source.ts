import { Injectable } from '@nestjs/common';
import { type FxRate, parseEcbXml } from './ecb';

export interface FxRateSource {
  /** Stored as `fx_rates.source` and on every converted transaction. */
  readonly name: string;
  /** `latest` is the most recent day; `history` covers about the last 90 days. */
  fetch(range: 'latest' | 'history'): Promise<FxRate[]>;
}

export const FX_RATE_SOURCE = Symbol('FX_RATE_SOURCE');

const FEEDS = {
  latest: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
  history: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
} as const;
const TIMEOUT_MS = 10_000;

@Injectable()
export class EcbRateSource implements FxRateSource {
  readonly name = 'ecb';

  async fetch(range: 'latest' | 'history'): Promise<FxRate[]> {
    const response = await fetch(FEEDS[range], { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`ECB feed returned ${response.status}`);
    return parseEcbXml(await response.text());
  }
}

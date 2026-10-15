import { Injectable } from '@nestjs/common';
import { type FxRate, parseEcbXml } from './ecb';

/** `latest` is the most recent day, `history` about the last 90 days, `full` every day since 1999. */
export type FxFeed = 'latest' | 'history' | 'full';

export interface FxRateSource {
  /** Stored as `fx_rates.source` and on every converted transaction. */
  readonly name: string;
  fetch(feed: FxFeed): Promise<FxRate[]>;
}

export const FX_RATE_SOURCE = Symbol('FX_RATE_SOURCE');

const FEEDS: Record<FxFeed, { url: string; timeoutMs: number; maxBytes: number }> = {
  latest: {
    url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    timeoutMs: 10_000,
    maxBytes: 1_000_000,
  },
  history: {
    url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
    timeoutMs: 10_000,
    maxBytes: 5_000_000,
  },
  full: {
    url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml',
    timeoutMs: 60_000,
    maxBytes: 60_000_000,
  },
};

@Injectable()
export class EcbRateSource implements FxRateSource {
  readonly name = 'ecb';

  async fetch(feed: FxFeed): Promise<FxRate[]> {
    const { url, timeoutMs, maxBytes } = FEEDS[feed];
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`ECB feed returned ${response.status}`);
    return parseEcbXml(await readCapped(response, maxBytes));
  }
}

/** Reads the body, giving up as soon as it exceeds `maxBytes` (counted after decompression). */
export async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    throw new Error('ECB feed is too large');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error('ECB feed is too large');
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetches the feeds in order, each on its own: a failed feed is reported and contributes
 * nothing, and a later feed's rate for the same day and currency wins.
 */
export async function fetchFeeds(
  source: FxRateSource,
  feeds: readonly FxFeed[],
  onFailure: (feed: FxFeed, error: unknown) => void,
): Promise<FxRate[]> {
  const rates = new Map<string, FxRate>();
  for (const feed of feeds) {
    try {
      for (const rate of await source.fetch(feed)) rates.set(`${rate.currency}:${rate.date}`, rate);
    } catch (error) {
      onFailure(feed, error);
    }
  }
  return [...rates.values()];
}

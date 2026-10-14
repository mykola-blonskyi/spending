import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type CurrencyCode, parseCurrency } from '../common/money';
import { importHashes, normalizeDescription } from './dedupe';
import type { NormalizedRow } from './rows';

const ACCOUNT = '6f1c1a52-8d43-4c43-9a43-1f1f6d3b9a10';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const row = (extra: Partial<NormalizedRow> = {}): NormalizedRow => ({
  line: 2,
  occurredOn: '2026-10-01',
  kind: 'expense',
  amountMinor: 1250,
  currency: parseCurrency('EUR') as CurrencyCode,
  description: 'Mercadona',
  externalId: null,
  ...extra,
});

describe('normalizeDescription', () => {
  it('folds case, compatibility forms and whitespace', () => {
    expect(normalizeDescription('  ＭＥＲＣＡＤＯＮＡ\t  Valencia  ')).toBe('mercadona valencia');
  });
});

describe('importHashes', () => {
  it('hashes the documented tuple with an ordinal', () => {
    expect(importHashes(ACCOUNT, [row()])).toEqual([
      sha(`row:${ACCOUNT}:2026-10-01:-1250:EUR:mercadona:0`),
    ]);
  });

  it('gives identical purchases in one file distinct keys by ordinal', () => {
    const [a, b, c] = importHashes(ACCOUNT, [
      row({ line: 2 }),
      row({ line: 3, description: ' MERCADONA ' }),
      row({ line: 4 }),
    ]);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(c).toBe(sha(`row:${ACCOUNT}:2026-10-01:-1250:EUR:mercadona:2`));
  });

  it('counts ordinals per tuple, not per file position', () => {
    const [, , third] = importHashes(ACCOUNT, [
      row(),
      row({ description: 'Lidl' }),
      row({ description: 'mercadona' }),
    ]);
    expect(third).toBe(sha(`row:${ACCOUNT}:2026-10-01:-1250:EUR:mercadona:1`));
  });

  it('is stable across files that share a prefix of rows', () => {
    const first = importHashes(ACCOUNT, [row(), row({ occurredOn: '2026-10-02' })]);
    const overlapping = importHashes(ACCOUNT, [
      row(),
      row({ occurredOn: '2026-10-02' }),
      row({ occurredOn: '2026-10-03' }),
    ]);
    expect(overlapping.slice(0, 2)).toEqual(first);
  });

  it('separates income from expense, currencies and accounts', () => {
    const hashes = new Set([
      ...importHashes(ACCOUNT, [row(), row({ kind: 'income' })]),
      ...importHashes(ACCOUNT, [row({ currency: parseCurrency('USD') as CurrencyCode })]),
      ...importHashes('00000000-0000-4000-8000-000000000000', [row()]),
    ]);
    expect(hashes.size).toBe(4);
  });

  it('uses the provider id alone when present', () => {
    const [a, b] = importHashes(ACCOUNT, [
      row({ externalId: 'TX-1' }),
      row({ externalId: 'TX-2' }),
    ]);
    expect(a).toBe(sha(`ext:${ACCOUNT}:TX-1`));
    expect(b).not.toBe(a);
    expect(importHashes(ACCOUNT, [row({ externalId: 'TX-1', amountMinor: 99 })])[0]).toBe(a);
  });

  it('does not advance tuple ordinals for rows keyed by provider id', () => {
    const [, second] = importHashes(ACCOUNT, [row({ externalId: 'TX-1' }), row()]);
    expect(second).toBe(sha(`row:${ACCOUNT}:2026-10-01:-1250:EUR:mercadona:0`));
  });
});

import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './history';

const ID = 'e0000000-0000-4000-8000-000000000006';
const forge = (createdAt: string, occurredOn = '2026-10-14') =>
  Buffer.from(JSON.stringify([occurredOn, createdAt, ID])).toString('base64url');

describe('decodeCursor', () => {
  it('reads back what encodeCursor wrote, microseconds included', () => {
    const cursor = { occurredOn: '2026-10-14', createdAt: '2026-10-14T09:30:00.123456Z', id: ID };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ['an impossible day', forge('2026-02-30T00:00:00.000000Z')],
    ['hour 24', forge('2026-10-14T24:00:00.000000Z')],
    ['a leap second', forge('2026-10-14T23:59:60.000000Z')],
    ['a year outside the range', forge('0000-01-01T00:00:00.000000Z')],
    ['an impossible occurredOn', forge('2026-10-14T00:00:00.000000Z', '2026-02-30')],
    ['milliseconds only', forge('2026-10-14T00:00:00.000Z')],
    ['not base64 JSON', '!!!'],
  ])('rejects %s', (_name, text) => {
    expect(decodeCursor(text)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from './default-categories';
import { createInvitationBodySchema, familyNameBodySchema, invitationState } from './family';

const now = new Date('2026-10-14T12:00:00Z');
const later = new Date('2026-10-15T12:00:00Z');
const earlier = new Date('2026-10-13T12:00:00Z');

describe('invitationState', () => {
  it.each([
    [{ acceptedAt: null, revokedAt: null, expiresAt: later }, 'pending'],
    [{ acceptedAt: earlier, revokedAt: null, expiresAt: earlier }, 'accepted'],
    [{ acceptedAt: null, revokedAt: earlier, expiresAt: later }, 'revoked'],
    [{ acceptedAt: null, revokedAt: earlier, expiresAt: earlier }, 'revoked'],
    [{ acceptedAt: null, revokedAt: null, expiresAt: now }, 'expired'],
  ] as const)('derives %j as %s', (invitation, state) => {
    expect(invitationState(invitation, now)).toBe(state);
  });
});

describe('request schemas', () => {
  it('trims family names and bounds them to 1..60', () => {
    expect(familyNameBodySchema.parse({ name: '  Home ' })).toEqual({ name: 'Home' });
    expect(familyNameBodySchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(familyNameBodySchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
  });

  it('defaults invitation lifetime to 7 days and allows 1..30', () => {
    expect(createInvitationBodySchema.parse({})).toEqual({ expiresInDays: 7 });
    expect(createInvitationBodySchema.safeParse({ expiresInDays: 0 }).success).toBe(false);
    expect(createInvitationBodySchema.safeParse({ expiresInDays: 31 }).success).toBe(false);
    expect(createInvitationBodySchema.safeParse({ expiresInDays: 1.5 }).success).toBe(false);
  });
});

describe('DEFAULT_CATEGORIES', () => {
  it('has unique system keys', () => {
    const keys = DEFAULT_CATEGORIES.map((c) => c.systemKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEFAULT_CATEGORIES.filter((c) => c.kind === 'expense')).toHaveLength(14);
    expect(DEFAULT_CATEGORIES.filter((c) => c.kind === 'income')).toHaveLength(6);
  });

  it('uses #rrggbb colors and lucide-style icon names', () => {
    for (const c of DEFAULT_CATEGORIES) {
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.icon).toMatch(/^[a-z0-9-]{1,40}$/);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { canonicalTimezone, identityFromClaims, profilePatchSchema } from './profile';

describe('identityFromClaims', () => {
  it('maps provider claims to a profile', () => {
    expect(
      identityFromClaims({
        sub: 'u1',
        email: 'ann@example.test',
        name: '  Ann  ',
        picture: 'https://cdn.example/a.png',
        locale: 'uk',
        'https://blonskyi.dev/theme': 'dark',
      }),
    ).toEqual({
      sub: 'u1',
      email: 'ann@example.test',
      displayName: 'Ann',
      avatarUrl: 'https://cdn.example/a.png',
      locale: 'uk',
      theme: 'dark',
      palette: 'emerald',
    });
  });

  it('falls back on unknown optional claims', () => {
    expect(
      identityFromClaims({
        sub: 'u1',
        email: 'ann@example.test',
        picture: 'javascript:alert(1)',
        locale: 'de',
        'https://blonskyi.dev/theme': 'theme-rose',
      }),
    ).toMatchObject({
      displayName: 'ann@example.test',
      avatarUrl: null,
      locale: 'en',
      theme: 'system',
      palette: 'rose',
    });
  });

  it('rejects tokens without sub or email', () => {
    expect(identityFromClaims({ email: 'a@b.c' })).toBeNull();
    expect(identityFromClaims({ sub: 'u1' })).toBeNull();
  });
});

describe('profilePatchSchema', () => {
  it('trims names and canonicalizes IANA zones', () => {
    expect(profilePatchSchema.parse({ displayName: ' Ann ', timezone: 'Europe/Madrid' })).toEqual({
      displayName: 'Ann',
      timezone: 'Europe/Madrid',
    });
    expect(profilePatchSchema.parse({ timezone: 'UTC' })).toEqual({ timezone: 'UTC' });
  });

  it('accepts layout and palette', () => {
    expect(profilePatchSchema.parse({ layout: 'bento', palette: 'ocean' })).toEqual({
      layout: 'bento',
      palette: 'ocean',
    });
  });

  it('accepts zone aliases the runtime knows under another canonical name', () => {
    expect(['Europe/Kyiv', 'Europe/Kiev']).toContain(canonicalTimezone('Europe/Kyiv'));
  });

  it.each([
    { displayName: '   ' },
    { displayName: 'a'.repeat(81) },
    { locale: 'de' },
    { theme: 'rose' },
    { layout: 'grid' },
    { palette: 'teal' },
    { timezone: 'Mars/Olympus' },
    { timezone: '+01:00' },
    { userId: 'x' },
  ])('rejects %j', (patch) => {
    expect(profilePatchSchema.safeParse(patch).success).toBe(false);
  });
});

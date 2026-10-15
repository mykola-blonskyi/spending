import { z } from 'zod';

export const LOCALES = ['en', 'uk', 'ru', 'es'] as const;
export const THEMES = ['light', 'dark', 'system'] as const;
export const LAYOUTS = [
  'calm',
  'cards',
  'soft',
  'journal',
  'bento',
  'split',
  'playful',
  'hybrid',
] as const;
export const PALETTES = ['emerald', 'rose', 'ocean', 'sand', 'graphite'] as const;
export type Locale = (typeof LOCALES)[number];
export type Theme = (typeof THEMES)[number];
export type Layout = (typeof LAYOUTS)[number];
export type Palette = (typeof PALETTES)[number];

const DISPLAY_NAME_MAX = 80;
const THEME_CLAIM = 'https://blonskyi.dev/theme';

const timezones = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

/**
 * Returns the runtime's canonical IANA name ("Europe/Kyiv" may become "Europe/Kiev"), or null.
 * The set check rejects inputs Intl also accepts but that are not zones, such as "+01:00".
 */
export function canonicalTimezone(value: string): string | null {
  try {
    const resolved = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
    return timezones.has(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/** An IANA zone, stored in its canonical spelling. */
export const timezoneSchema = z
  .string()
  .max(64)
  .transform((value, ctx) => {
    const zone = canonicalTimezone(value);
    if (!zone) ctx.addIssue({ code: 'custom', message: 'unknown time zone' });
    return zone ?? z.NEVER;
  });

export const profileSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  // nestjs-zod renders a nullable top-level DTO property as an array; a named schema avoids it.
  avatarUrl: z.string().nullable().meta({ id: 'AvatarUrl' }),
  locale: z.enum(LOCALES),
  theme: z.enum(THEMES),
  layout: z.enum(LAYOUTS),
  palette: z.enum(PALETTES),
  timezone: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;

export const profilePatchSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX).optional(),
  locale: z.enum(LOCALES).optional(),
  theme: z.enum(THEMES).optional(),
  layout: z.enum(LAYOUTS).optional(),
  palette: z.enum(PALETTES).optional(),
  timezone: timezoneSchema.optional(),
});
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(3),
  name: z.string().optional().catch(undefined),
  picture: z
    .url({ protocol: /^https?$/ })
    .optional()
    .catch(undefined),
  locale: z.enum(LOCALES).optional().catch(undefined),
  [THEME_CLAIM]: z.string().optional().catch(undefined),
});

/** What the provider tells us about a user, normalized to our profile vocabulary. */
export type Identity = Readonly<{
  sub: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  locale: Locale;
  theme: Theme;
  palette: Palette;
}>;

function mapTheme(claim: string | undefined): Theme {
  return claim === 'light' || claim === 'dark' ? claim : 'system';
}

function mapPalette(claim: string | undefined): Palette {
  const name = claim?.startsWith('theme-') ? claim.slice('theme-'.length) : undefined;
  return PALETTES.find((palette) => palette === name) ?? 'emerald';
}

/** Returns null when the ID token lacks the claims a user row requires. */
export function identityFromClaims(claims: Record<string, unknown>): Identity | null {
  const parsed = claimsSchema.safeParse(claims);
  if (!parsed.success) return null;
  const c = parsed.data;
  const name = c.name?.trim().slice(0, DISPLAY_NAME_MAX);
  return {
    sub: c.sub,
    email: c.email,
    displayName: name || c.email.slice(0, DISPLAY_NAME_MAX),
    avatarUrl: c.picture ?? null,
    locale: c.locale ?? 'en',
    theme: mapTheme(c[THEME_CLAIM]),
    palette: mapPalette(c[THEME_CLAIM]),
  };
}

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'spending.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Matches `--background` in styles.css so the browser chrome blends with the page. */
const THEME_COLOR: Record<ResolvedTheme, string> = { light: '#fafaf9', dark: '#0d1013' };

function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the choice lasts this session.
  }
}

export function systemDarkQuery(): MediaQueryList | undefined {
  return typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : undefined;
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement) {
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.content = THEME_COLOR[theme];
}

/** Runs before the first render so the page never flashes the wrong theme. */
export function applyStoredTheme(): void {
  applyTheme(resolveTheme(readThemePreference(), systemDarkQuery()?.matches ?? false));
}

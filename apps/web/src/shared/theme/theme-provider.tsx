import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { applyPalette, readPalettePreference, writePalettePreference } from './palette';
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  systemDarkQuery,
  writeThemePreference,
} from './theme';
import { ThemeContext, type ThemeContextValue } from './theme-context';

function subscribeSystemDark(onChange: () => void) {
  const query = systemDarkQuery();
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

const getSystemDark = () => systemDarkQuery()?.matches ?? false;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState(readThemePreference);
  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark, () => false);
  const resolved = resolveTheme(preference, systemDark);
  const [palette, setPaletteState] = useState(readPalettePreference);

  useEffect(() => applyTheme(resolved), [resolved]);
  useEffect(() => applyPalette(palette), [palette]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      palette,
      setPreference: (next) => {
        writeThemePreference(next);
        setPreferenceState(next);
      },
      setPalette: (next) => {
        writePalettePreference(next);
        setPaletteState(next);
      },
    }),
    [preference, resolved, palette],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

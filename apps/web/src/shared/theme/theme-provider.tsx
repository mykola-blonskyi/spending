import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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

  useEffect(() => applyTheme(resolved), [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      setPreference: (next) => {
        writeThemePreference(next);
        setPreferenceState(next);
      },
    }),
    [preference, resolved],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

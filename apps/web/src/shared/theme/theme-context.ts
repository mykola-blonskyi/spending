import { createContext, use } from 'react';
import type { Palette } from './palette';
import type { ResolvedTheme, ThemePreference } from './theme';

export type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  palette: Palette;
  setPreference: (preference: ThemePreference) => void;
  setPalette: (palette: Palette) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}

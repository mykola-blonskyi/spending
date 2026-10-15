export const PALETTES = ['emerald', 'rose', 'ocean', 'sand', 'graphite'] as const;
export type Palette = (typeof PALETTES)[number];

export const PALETTE_STORAGE_KEY = 'spending.palette';

export function isPalette(value: unknown): value is Palette {
  return PALETTES.includes(value as Palette);
}

export function readPalettePreference(): Palette {
  try {
    const stored = localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPalette(stored) ? stored : 'emerald';
  } catch {
    return 'emerald';
  }
}

export function writePalettePreference(palette: Palette): void {
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, palette);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the choice lasts this session.
  }
}

/** styles.css scopes every non-emerald token set to `[data-palette]`; emerald is the `:root` default. */
export function applyPalette(palette: Palette, root: HTMLElement = document.documentElement) {
  root.dataset.palette = palette;
}

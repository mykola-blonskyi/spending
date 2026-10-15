import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyStoredTheme,
  PALETTE_STORAGE_KEY,
  PALETTES,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  ThemeProvider,
  useTheme,
} from './index';

function mockSystemDark(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return (dark: boolean) => {
    query.matches = dark;
    listeners.forEach((listener) => listener());
  };
}

function Probe() {
  const { preference, resolved, palette, setPreference, setPalette } = useTheme();
  return (
    <>
      <output>{`${preference}:${resolved}:${palette}`}</output>
      <button onClick={() => setPreference('light')}>light</button>
      <button onClick={() => setPreference('system')}>system</button>
      <button onClick={() => setPalette('rose')}>rose</button>
    </>
  );
}

const root = document.documentElement;
const themeColor = () =>
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content;

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    root.className = '';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('applies the stored preference and palette before render', () => {
    mockSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    localStorage.setItem(PALETTE_STORAGE_KEY, 'sand');
    applyStoredTheme();
    expect(root).toHaveClass('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(themeColor()).toBe('#0d1013');
    expect(root.dataset.palette).toBe('sand');
  });

  it('ignores unknown stored values and falls back to system and emerald', () => {
    mockSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    localStorage.setItem(PALETTE_STORAGE_KEY, 'teal');
    applyStoredTheme();
    expect(root).toHaveClass('dark');
    expect(root.dataset.palette).toBe('emerald');
  });

  it('follows prefers-color-scheme live while set to system', () => {
    const setSystemDark = mockSystemDark(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('system:light:emerald');
    expect(root).not.toHaveClass('dark');

    act(() => setSystemDark(true));
    expect(screen.getByRole('status')).toHaveTextContent('system:dark:emerald');
    expect(root).toHaveClass('dark');
    expect(themeColor()).toBe('#0d1013');
  });

  it('persists an explicit choice and stops following the system', async () => {
    const setSystemDark = mockSystemDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'light' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(root).not.toHaveClass('dark');
    expect(themeColor()).toBe('#fafaf9');

    act(() => setSystemDark(true));
    expect(root).not.toHaveClass('dark');
  });

  it('persists the palette and applies it to the document', async () => {
    mockSystemDark(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(root.dataset.palette).toBe('emerald');
    await userEvent.click(screen.getByRole('button', { name: 'rose' }));
    expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('rose');
    expect(root.dataset.palette).toBe('rose');
    expect(screen.getByRole('status')).toHaveTextContent('system:light:rose');
  });

  it('keeps working when storage throws', async () => {
    mockSystemDark(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'light' }));
    expect(screen.getByRole('status')).toHaveTextContent('light:light:emerald');
    vi.restoreAllMocks();
  });

  it('keeps the head script in agreement with the TS constants', () => {
    const script = readFileSync(resolve(process.cwd(), 'public/theme-init.js'), 'utf8');
    expect(script).toContain(`'${THEME_STORAGE_KEY}'`);
    for (const value of ['light', 'dark']) expect(script).toContain(`'${value}'`);
    expect(THEME_PREFERENCES).toContain('system');
    expect(script).toContain(`'${PALETTE_STORAGE_KEY}'`);
    for (const palette of PALETTES) expect(script).toContain(`'${palette}'`);
    expect(script).toContain('(prefers-color-scheme: dark)');
    expect(script).toContain("'#fafaf9'");
    expect(script).toContain("'#0d1013'");
  });

  it('theme-init.js resolves the same result as applyStoredTheme', () => {
    const script = readFileSync(resolve(process.cwd(), 'public/theme-init.js'), 'utf8');
    const observed = () => [root.classList.contains('dark'), themeColor(), root.dataset.palette];
    for (const [stored, systemDark, palette] of [
      ['dark', false, 'ocean'],
      ['light', true, null],
      ['sepia', true, 'teal'],
      [null, false, 'graphite'],
    ] as const) {
      mockSystemDark(systemDark);
      localStorage.clear();
      if (stored) localStorage.setItem(THEME_STORAGE_KEY, stored);
      if (palette) localStorage.setItem(PALETTE_STORAGE_KEY, palette);
      root.className = '';
      applyStoredTheme();
      const expected = observed();
      root.className = '';
      delete root.dataset.palette;
      document.querySelector('meta[name="theme-color"]')?.remove();
      new Function(script)();
      expect(observed()).toEqual(expected);
    }
  });
});

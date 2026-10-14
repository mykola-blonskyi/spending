import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStoredTheme, THEME_STORAGE_KEY, ThemeProvider, useTheme } from './index';

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
  const { preference, resolved, setPreference } = useTheme();
  return (
    <>
      <output>{`${preference}:${resolved}`}</output>
      <button onClick={() => setPreference('light')}>light</button>
      <button onClick={() => setPreference('system')}>system</button>
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

  it('applies the stored preference before render', () => {
    mockSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    applyStoredTheme();
    expect(root).toHaveClass('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(themeColor()).toBe('#0d1013');
  });

  it('ignores an unknown stored value and follows the system', () => {
    mockSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    applyStoredTheme();
    expect(root).toHaveClass('dark');
  });

  it('follows prefers-color-scheme live while set to system', () => {
    const setSystemDark = mockSystemDark(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('system:light');
    expect(root).not.toHaveClass('dark');

    act(() => setSystemDark(true));
    expect(screen.getByRole('status')).toHaveTextContent('system:dark');
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
    expect(screen.getByRole('status')).toHaveTextContent('light:light');
    vi.restoreAllMocks();
  });
});

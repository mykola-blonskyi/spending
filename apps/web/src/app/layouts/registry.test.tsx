import { describe, expect, it } from 'vitest';
import { LAYOUT_IDS, LAYOUTS, screenFor } from './registry';

describe('layout registry', () => {
  it('serves the calm screen when a layout has no override', () => {
    for (const layout of LAYOUT_IDS) {
      expect(screenFor(layout, 'dashboard')).toBe(LAYOUTS.calm.screens.dashboard);
      expect(screenFor(layout, 'history')).toBe(LAYOUTS.calm.screens.history);
      expect(screenFor(layout, 'entry')).toBe(LAYOUTS.calm.screens.entry);
    }
  });

  it('gives hybrid the calm shell', () => {
    expect(LAYOUTS.hybrid.shell).toBe(LAYOUTS.calm.shell);
  });
});

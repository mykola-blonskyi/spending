import { describe, expect, it } from 'vitest';
import { LAYOUT_IDS, LAYOUTS, screenFor } from './registry';

describe('layout registry', () => {
  it('resolves every screen for every layout', () => {
    for (const layout of LAYOUT_IDS) {
      for (const screen of ['dashboard', 'history', 'entry', 'detail'] as const) {
        expect(screenFor(layout, screen), `${layout} ${screen}`).toBeTypeOf('function');
      }
    }
  });

  it('edits in the entry screen when a layout has no detail screen', () => {
    for (const layout of LAYOUT_IDS) {
      const { screens } = LAYOUTS[layout];
      expect(screenFor(layout, 'detail')).toBe(screens.detail ?? screenFor(layout, 'entry'));
    }
  });

  it('gives hybrid the calm shell and the bento dashboard', () => {
    expect(LAYOUTS.hybrid.shell).toBe(LAYOUTS.calm.shell);
    expect(screenFor('hybrid', 'dashboard')).toBe(screenFor('bento', 'dashboard'));
  });
});

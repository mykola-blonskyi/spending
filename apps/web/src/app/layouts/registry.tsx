import type { ComponentType } from 'react';
import type { Profile } from '@data/session';
import {
  BentoShell,
  CalmShell,
  CardsShell,
  JournalShell,
  PlayfulShell,
  type ShellProps,
  SoftShell,
  SplitShell,
} from '@shared/shell';
import { DASHBOARD_SCREENS } from '@features/dashboard';
import { TRANSACTION_SCREENS } from '@features/transactions';

export type Layout = Profile['layout'];
export type LayoutScreen = 'dashboard' | 'history' | 'entry' | 'detail';

type LayoutDefinition = {
  shell: ComponentType<ShellProps>;
  /** A screen a layout does not override falls back to the calm version. */
  screens: Partial<Record<LayoutScreen, ComponentType>>;
};

const screensOf = (layout: Layout) => ({
  dashboard: DASHBOARD_SCREENS[layout],
  ...TRANSACTION_SCREENS[layout],
});
const calmScreens = screensOf('calm');

/** Order is the order in the settings picker. */
export const LAYOUTS: Record<Layout, LayoutDefinition> = {
  calm: { shell: CalmShell, screens: calmScreens },
  cards: { shell: CardsShell, screens: screensOf('cards') },
  soft: { shell: SoftShell, screens: screensOf('soft') },
  journal: { shell: JournalShell, screens: screensOf('journal') },
  bento: { shell: BentoShell, screens: screensOf('bento') },
  split: { shell: SplitShell, screens: screensOf('split') },
  playful: { shell: PlayfulShell, screens: screensOf('playful') },
  // Calm base with the bento dashboard.
  hybrid: { shell: CalmShell, screens: screensOf('hybrid') },
};

export const LAYOUT_IDS = Object.keys(LAYOUTS) as Layout[];

/** `detail` (`/transactions/:id`) falls back to the layout's entry screen, which edits by `:id`. */
export function screenFor(layout: Layout, screen: LayoutScreen): ComponentType {
  const screens = LAYOUTS[layout].screens;
  if (screen === 'detail') return screens.detail ?? screens.entry ?? calmScreens.entry;
  return screens[screen] ?? calmScreens[screen];
}

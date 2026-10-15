import { LayoutDashboard } from 'lucide-react';
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
import { TRANSACTION_SCREENS } from '@features/transactions';
import { PlaceholderPage } from '../pages/placeholder-page';

export type Layout = Profile['layout'];
export type LayoutScreen = 'dashboard' | 'history' | 'entry' | 'detail';

type LayoutDefinition = {
  shell: ComponentType<ShellProps>;
  /** A screen a layout does not override falls back to the calm version. */
  screens: Partial<Record<LayoutScreen, ComponentType>>;
};

const calmScreens = {
  dashboard: () => <PlaceholderPage page="dashboard" icon={LayoutDashboard} />,
  ...TRANSACTION_SCREENS.calm,
} satisfies Partial<Record<LayoutScreen, ComponentType>>;

/** Order is the order in the settings picker. */
export const LAYOUTS: Record<Layout, LayoutDefinition> = {
  calm: { shell: CalmShell, screens: calmScreens },
  cards: { shell: CardsShell, screens: TRANSACTION_SCREENS.cards },
  soft: { shell: SoftShell, screens: TRANSACTION_SCREENS.soft },
  journal: { shell: JournalShell, screens: TRANSACTION_SCREENS.journal },
  bento: { shell: BentoShell, screens: TRANSACTION_SCREENS.bento },
  split: { shell: SplitShell, screens: TRANSACTION_SCREENS.split },
  playful: { shell: PlayfulShell, screens: TRANSACTION_SCREENS.playful },
  // Calm base; its bento dashboard arrives with that feature.
  hybrid: { shell: CalmShell, screens: TRANSACTION_SCREENS.hybrid },
};

export const LAYOUT_IDS = Object.keys(LAYOUTS) as Layout[];

/** `detail` (`/transactions/:id`) falls back to the layout's entry screen, which edits by `:id`. */
export function screenFor(layout: Layout, screen: LayoutScreen): ComponentType {
  const screens = LAYOUTS[layout].screens;
  if (screen === 'detail') return screens.detail ?? screens.entry ?? calmScreens.entry;
  return screens[screen] ?? calmScreens[screen];
}

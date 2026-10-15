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
import { NewTransactionPage, TransactionsPage } from '@features/transactions';
import { PlaceholderPage } from '../pages/placeholder-page';

export type Layout = Profile['layout'];
export type LayoutScreen = 'dashboard' | 'history' | 'entry';

type LayoutDefinition = {
  shell: ComponentType<ShellProps>;
  /** A screen a layout does not override falls back to the calm version. */
  screens: Partial<Record<LayoutScreen, ComponentType>>;
};

const calmScreens: Record<LayoutScreen, ComponentType> = {
  dashboard: () => <PlaceholderPage page="dashboard" icon={LayoutDashboard} />,
  history: TransactionsPage,
  entry: NewTransactionPage,
};

/** Order is the order in the settings picker. */
export const LAYOUTS: Record<Layout, LayoutDefinition> = {
  calm: { shell: CalmShell, screens: calmScreens },
  cards: { shell: CardsShell, screens: {} },
  soft: { shell: SoftShell, screens: {} },
  journal: { shell: JournalShell, screens: {} },
  bento: { shell: BentoShell, screens: {} },
  split: { shell: SplitShell, screens: {} },
  playful: { shell: PlayfulShell, screens: {} },
  // Calm base; its bento dashboard, split history and keypad entry arrive with those features.
  hybrid: { shell: CalmShell, screens: {} },
};

export const LAYOUT_IDS = Object.keys(LAYOUTS) as Layout[];

export function screenFor(layout: Layout, screen: LayoutScreen): ComponentType {
  return LAYOUTS[layout].screens[screen] ?? calmScreens[screen];
}

import type { ComponentType } from 'react';
import { BentoDashboard } from './bento-dashboard';
import { CalmDashboard } from './calm-dashboard';
import { CardsDashboard } from './cards-dashboard';
import { JournalDashboard } from './journal-dashboard';
import { PlayfulDashboard } from './playful-dashboard';
import { SoftDashboard } from './soft-dashboard';
import { SplitDashboard } from './split-dashboard';

/** Per layout; hybrid shares the bento dashboard. */
export const DASHBOARD_SCREENS = {
  calm: CalmDashboard,
  cards: CardsDashboard,
  soft: SoftDashboard,
  journal: JournalDashboard,
  bento: BentoDashboard,
  split: SplitDashboard,
  playful: PlayfulDashboard,
  hybrid: BentoDashboard,
} as const satisfies Record<string, ComponentType>;

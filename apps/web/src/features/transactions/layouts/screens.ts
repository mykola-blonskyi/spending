import type { ComponentType } from 'react';
import { CalmEntry } from './calm-entry';
import { CalmHistory } from './calm-history';
import { CardsEntry } from './cards-entry';
import { CardsHistory } from './cards-history';
import { PlayfulEntry } from './playful-entry';
import { PlayfulHistory } from './playful-history';
import { SoftEntry } from './soft-entry';
import { SoftHistory } from './soft-history';
import { BentoEntry } from './bento-entry';
import { BentoHistory } from './bento-history';
import { JournalEntry } from './journal-entry';
import { JournalHistory } from './journal-history';
import { HybridEntry } from './hybrid-entry';
import { HybridHistory } from './hybrid-history';
import { SplitEntry } from './split-entry';
import { SplitHistory } from './split-history';

/** A layout's transaction screens. Without `detail`, `/transactions/:id` edits in its entry screen. */
export type TransactionScreens = Readonly<{
  history: ComponentType;
  entry: ComponentType;
  detail?: ComponentType;
}>;

export const TRANSACTION_SCREENS = {
  calm: { history: CalmHistory, entry: CalmEntry },
  cards: { history: CardsHistory, entry: CardsEntry },
  soft: { history: SoftHistory, entry: SoftEntry },
  journal: { history: JournalHistory, entry: JournalEntry },
  bento: { history: BentoHistory, entry: BentoEntry },
  split: { history: SplitHistory, entry: SplitEntry, detail: SplitHistory },
  playful: { history: PlayfulHistory, entry: PlayfulEntry },
  hybrid: { history: HybridHistory, entry: HybridEntry, detail: HybridHistory },
} as const satisfies Record<string, TransactionScreens>;

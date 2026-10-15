import {
  ArrowLeftRight,
  FileUp,
  Folders,
  LayoutDashboard,
  PiggyBank,
  Repeat,
  RefreshCw,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Messages } from '@i18n/index';

type Destination = {
  path: string;
  nav: keyof Messages['nav'];
  icon: LucideIcon;
  placement: 'primary' | 'secondary';
};

/** Order is the navigation order. The first three primary entries fill the mobile tab bar. */
export const DESTINATIONS = [
  { path: '/', nav: 'dashboard', icon: LayoutDashboard, placement: 'primary' },
  { path: '/transactions', nav: 'transactions', icon: ArrowLeftRight, placement: 'primary' },
  { path: '/budgets', nav: 'budgets', icon: PiggyBank, placement: 'primary' },
  { path: '/accounts', nav: 'accounts', icon: Wallet, placement: 'secondary' },
  { path: '/categories', nav: 'categories', icon: Folders, placement: 'secondary' },
  { path: '/recurring', nav: 'recurring', icon: Repeat, placement: 'secondary' },
  { path: '/imports', nav: 'imports', icon: FileUp, placement: 'secondary' },
  { path: '/family', nav: 'family', icon: Users, placement: 'secondary' },
  { path: '/sync', nav: 'sync', icon: RefreshCw, placement: 'secondary' },
  { path: '/settings', nav: 'settings', icon: Settings, placement: 'secondary' },
] as const satisfies readonly Destination[];

export const ADD_TRANSACTION_PATH = '/transactions/new';

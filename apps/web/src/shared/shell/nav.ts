import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { matchPath, useLocation } from 'react-router';

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Primary items sit in the mobile tab bar; secondary ones live behind "More". */
  placement: 'primary' | 'secondary';
};

export type PrimaryAction = { to: string; label: string; icon: LucideIcon };

/** Every layout's shell takes the same input, so the app can swap shells without re-wiring. */
export type ShellProps = {
  brand: React.ReactNode;
  /** A compact version for shells whose rail has no room for the name. */
  brandMark?: React.ReactNode;
  navItems: readonly NavItem[];
  primaryAction: PrimaryAction;
  status?: React.ReactNode;
  banner?: React.ReactNode;
  children: React.ReactNode;
};

export const MAIN_ID = 'main';

export const focusRing =
  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export const isEnd = (to: string) => to === '/';

export function splitNav(navItems: readonly NavItem[]) {
  return {
    primary: navItems.filter((item) => item.placement === 'primary'),
    secondary: navItems.filter((item) => item.placement === 'secondary'),
  };
}

/** Open state for a "More" control plus whether the current page lives behind it. */
export function useMore(secondary: readonly NavItem[]) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const active = secondary.some((item) => matchPath({ path: item.to, end: false }, pathname));
  return { open, setOpen, active };
}

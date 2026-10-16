import type { LucideIcon } from 'lucide-react';
import { matchPath, NavLink, useLocation } from 'react-router';
import { cn } from '@shared/lib/utils';
import { focusRing, MAIN_ID, type ShellProps, splitNav } from './nav';
import { MobileTabBar, SkipLink } from './shell-primitives';

const tabClass = (active: boolean) =>
  cn(
    'flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] leading-none font-medium transition-colors duration-150',
    active ? 'text-primary' : 'text-muted-foreground',
    focusRing,
  );

const tabIcon = (Icon: LucideIcon, active: boolean) => (
  <Icon aria-hidden className="size-6" strokeWidth={active ? 2.2 : 1.8} />
);

/** Card stack: a phone-width column on a muted canvas, an iOS tab bar and a floating add pill. */
export function CardsShell({
  brand,
  navItems,
  primaryAction,
  status,
  banner,
  children,
}: ShellProps) {
  const { primary, secondary } = splitNav(navItems);
  // The add and edit sheets fill the column; the floating add pill would sit on their keypad.
  const entryRoute = primaryAction.to.replace(/[^/]+$/, ':id');
  const onEntry = matchPath(entryRoute, useLocation().pathname) !== null;

  return (
    <div className="min-h-dvh bg-muted">
      <SkipLink />
      <div className="relative mx-auto flex min-h-dvh max-w-md flex-col bg-background lg:border-x">
        <header className="sticky top-0 z-30 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            {brand}
            {status}
          </div>
          {banner}
        </header>
        <main
          id={MAIN_ID}
          tabIndex={-1}
          className="flex-1 px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] outline-none"
        >
          {children}
        </main>
      </div>

      <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2">
        {!onEntry && (
          <NavLink
            to={primaryAction.to}
            className={cn(
              'absolute right-4 bottom-[calc(100%+12px)] flex h-14 items-center gap-2 rounded-2xl bg-primary pr-5 pl-4 text-[15px] font-semibold whitespace-nowrap text-primary-foreground shadow-[0_10px_24px_-10px_var(--primary)] transition-transform duration-150 ease-out active:scale-[0.96] dark:ring-1 dark:ring-foreground/15',
              focusRing,
            )}
          >
            <primaryAction.icon aria-hidden className="size-5" strokeWidth={2.4} />
            {primaryAction.label}
          </NavLink>
        )}
        <MobileTabBar
          primary={primary}
          secondary={secondary}
          tabClass={tabClass}
          icon={tabIcon}
          className="bg-card lg:border-x"
        />
      </div>
    </div>
  );
}

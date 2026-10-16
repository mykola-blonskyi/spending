import type { LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { focusRing, MAIN_ID, type ShellProps, splitNav } from './nav';
import { MobileTabBar, SidebarList, SkipLink } from './shell-primitives';

const sidebarItem = 'h-10 gap-3 rounded-lg px-3 text-sm [&>svg]:size-[18px]';

const tabClass = (active: boolean) =>
  cn(
    'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[11px] leading-none font-medium transition-colors duration-150 [&>svg]:transition-transform [&>svg]:duration-150 [&>svg]:ease-out active:[&>svg]:scale-90',
    active ? 'text-primary' : 'text-muted-foreground',
    focusRing,
  );

const tabIcon = (Icon: LucideIcon) => (
  <Icon aria-hidden className="size-[22px]" strokeWidth={1.9} />
);

/** Calm minimal: sidebar on desktop, bottom tabs with a round add button on mobile. */
export function CalmShell({
  brand,
  navItems,
  primaryAction,
  status,
  banner,
  children,
}: ShellProps) {
  const { strings } = useSharedLocale();
  const { primary, secondary } = splitNav(navItems);

  return (
    <div className="min-h-dvh bg-background">
      <SkipLink />

      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r bg-card/40 lg:flex">
        <div className="flex h-16 items-center px-6">{brand}</div>
        <div className="px-4 pb-4">
          <NavLink
            to={primaryAction.to}
            className={cn(
              'flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-primary/90 active:scale-[0.97]',
              focusRing,
            )}
          >
            <primaryAction.icon aria-hidden className="size-4" />
            {primaryAction.label}
          </NavLink>
        </div>
        <nav aria-label={strings.mainNavigation} className="flex-1 overflow-y-auto px-3 pb-6">
          <SidebarList items={primary} itemClass={sidebarItem} className="gap-0.5" />
          <div role="separator" className="mx-3 my-3 h-px bg-border" />
          <SidebarList items={secondary} itemClass={sidebarItem} className="gap-0.5" />
        </nav>
      </aside>

      <div className="flex min-h-dvh flex-col lg:pl-64">
        <header className="sticky top-0 z-30 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md supports-[backdrop-filter]:bg-background/70 lg:border-b-0">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6 lg:h-16 lg:justify-end lg:px-10">
            <div className="lg:hidden">{brand}</div>
            {status}
          </div>
          {banner}
        </header>

        <main
          id={MAIN_ID}
          tabIndex={-1}
          className="@container/main mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-10 lg:pt-2 lg:pb-12"
        >
          {children}
        </main>
      </div>

      <MobileTabBar
        primary={primary}
        secondary={secondary}
        tabClass={tabClass}
        icon={tabIcon}
        className="fixed inset-x-0 bottom-0 z-40 bg-background/90 backdrop-blur-md lg:hidden"
        add={
          <NavLink
            to={primaryAction.to}
            aria-label={primaryAction.label}
            className={cn(
              'flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/25 transition-transform duration-150 ease-out active:scale-[0.94]',
              focusRing,
            )}
          >
            <primaryAction.icon aria-hidden className="size-6" strokeWidth={2.2} />
          </NavLink>
        }
      />
    </div>
  );
}

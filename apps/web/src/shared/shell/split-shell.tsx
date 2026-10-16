import type { LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { focusRing, MAIN_ID, type ShellProps, splitNav } from './nav';
import { MobileTabBar, SidebarList, SkipLink } from './shell-primitives';

const sidebarItem = 'h-8 gap-2.5 rounded-md px-2.5 text-[13px] [&>svg]:size-4';

const tabClass = (active: boolean) =>
  cn(
    'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] leading-none font-medium transition-colors duration-150',
    active ? 'text-foreground' : 'text-muted-foreground',
    focusRing,
  );

const tabIcon = (Icon: LucideIcon, active: boolean) => (
  <Icon aria-hidden className="size-5" strokeWidth={active ? 2.2 : 1.8} />
);

/**
 * Split view: a compact sidebar and a full-height content area that pages can divide into list
 * and detail panes on desktop. Mobile collapses to one pane with bottom tabs.
 */
export function SplitShell({
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
    <div className="min-h-dvh bg-background text-[14px] lg:flex lg:h-dvh lg:overflow-hidden">
      <SkipLink />

      <aside className="hidden w-56 shrink-0 flex-col border-r bg-muted/40 lg:flex">
        <div className="flex h-12 items-center px-4 [&_a]:text-[14px]">{brand}</div>
        <div className="px-3">
          <NavLink
            to={primaryAction.to}
            className={cn(
              'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[13px] font-medium text-foreground transition-colors duration-150 hover:bg-muted',
              focusRing,
            )}
          >
            <primaryAction.icon aria-hidden className="size-3.5" strokeWidth={2.4} />
            {primaryAction.label}
          </NavLink>
        </div>
        <nav aria-label={strings.mainNavigation} className="mt-4 flex-1 overflow-y-auto px-3 pb-4">
          <SidebarList items={primary} itemClass={sidebarItem} className="gap-px" />
          <SidebarList
            items={secondary}
            itemClass={sidebarItem}
            className="mt-4 gap-px border-t pt-4"
          />
        </nav>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col lg:h-dvh lg:min-h-0">
        <header className="sticky top-0 z-30 shrink-0 border-b bg-background pt-[env(safe-area-inset-top)] lg:static">
          <div className="flex h-14 items-center justify-between gap-3 px-4 lg:h-12 lg:justify-end lg:px-6">
            <div className="lg:hidden">{brand}</div>
            {status}
          </div>
          {banner}
        </header>

        <main
          id={MAIN_ID}
          tabIndex={-1}
          className="@container/main min-h-0 flex-1 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none lg:overflow-y-auto lg:px-6 lg:pt-6 lg:pb-6"
        >
          {children}
        </main>
      </div>

      <MobileTabBar
        primary={primary}
        secondary={secondary}
        tabClass={tabClass}
        icon={tabIcon}
        className="fixed inset-x-0 bottom-0 z-40 bg-card lg:hidden"
        add={
          <NavLink
            to={primaryAction.to}
            aria-label={primaryAction.label}
            className={cn(
              'flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.94]',
              focusRing,
            )}
          >
            <primaryAction.icon aria-hidden className="size-5" strokeWidth={2.4} />
          </NavLink>
        }
      />
    </div>
  );
}

import { Ellipsis } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { focusRing, isEnd, MAIN_ID, type NavItem, type ShellProps, splitNav, useMore } from './nav';
import { MoreSheet, SkipLink } from './shell-primitives';

const tabClass = (active: boolean) =>
  cn(
    'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] leading-none font-medium transition-colors duration-150',
    active ? 'text-foreground' : 'text-muted-foreground',
    focusRing,
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
  const more = useMore(secondary);

  const tab = (item: NavItem) => (
    <li key={item.to} className="flex flex-1">
      <NavLink to={item.to} end={isEnd(item.to)} className={({ isActive }) => tabClass(isActive)}>
        {({ isActive }) => (
          <>
            <item.icon aria-hidden className="size-5" strokeWidth={isActive ? 2.2 : 1.8} />
            <span className="max-w-full truncate px-0.5">{item.label}</span>
          </>
        )}
      </NavLink>
    </li>
  );

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
          <SidebarList items={primary} />
          <SidebarList items={secondary} className="mt-4 border-t pt-4" />
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
          className="min-h-0 flex-1 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none lg:overflow-y-auto lg:px-6 lg:pt-6 lg:pb-6"
        >
          {children}
        </main>
      </div>

      <nav
        aria-label={strings.mainNavigation}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch px-2">
          {primary.slice(0, 2).map(tab)}
          <li className="flex items-center px-2">
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
          </li>
          {primary.slice(2).map(tab)}
          <li className="flex flex-1">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={more.open}
              className={tabClass(more.active || more.open)}
              onClick={() => more.setOpen(true)}
            >
              <Ellipsis aria-hidden className="size-5" strokeWidth={1.8} />
              <span>{strings.more}</span>
            </button>
          </li>
        </ul>
        <MoreSheet items={secondary} open={more.open} onOpenChange={more.setOpen} />
      </nav>
    </div>
  );
}

function SidebarList({ items, className }: { items: readonly NavItem[]; className?: string }) {
  return (
    <ul className={cn('flex flex-col gap-px', className)}>
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={isEnd(item.to)}
            className={({ isActive }) =>
              cn(
                'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors duration-150',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                focusRing,
              )
            }
          >
            <item.icon aria-hidden className="size-4" strokeWidth={1.9} />
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

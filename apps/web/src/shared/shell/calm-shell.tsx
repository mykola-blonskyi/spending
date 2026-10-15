import { Ellipsis } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import {
  focusRing,
  isEnd,
  MAIN_ID,
  type NavItem,
  type PrimaryAction,
  type ShellProps,
  splitNav,
  useMore,
} from './nav';
import { MoreSheet, SkipLink } from './shell-primitives';

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
          <SidebarList items={primary} />
          <div role="separator" className="mx-3 my-3 h-px bg-border" />
          <SidebarList items={secondary} />
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
          className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-10 lg:pt-2 lg:pb-12"
        >
          {children}
        </main>
      </div>

      <MobileTabBar primary={primary} secondary={secondary} primaryAction={primaryAction} />
    </div>
  );
}

function SidebarList({ items }: { items: readonly NavItem[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={isEnd(item.to)}
            className={({ isActive }) =>
              cn(
                'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                focusRing,
              )
            }
          >
            <item.icon aria-hidden className="size-[18px]" strokeWidth={1.9} />
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

const tabClass = (active: boolean) =>
  cn(
    'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[11px] leading-none font-medium transition-colors duration-150 [&>svg]:transition-transform [&>svg]:duration-150 [&>svg]:ease-out active:[&>svg]:scale-90',
    active ? 'text-primary' : 'text-muted-foreground',
    focusRing,
  );

function MobileTabBar({
  primary,
  secondary,
  primaryAction,
}: {
  primary: readonly NavItem[];
  secondary: readonly NavItem[];
  primaryAction: PrimaryAction;
}) {
  const { strings } = useSharedLocale();
  const more = useMore(secondary);
  const split = Math.ceil(primary.length / 2);

  const tab = (item: NavItem) => (
    <li key={item.to} className="flex flex-1">
      <NavLink to={item.to} end={isEnd(item.to)} className={({ isActive }) => tabClass(isActive)}>
        <item.icon aria-hidden className="size-[22px]" strokeWidth={1.9} />
        <span className="max-w-full truncate px-0.5">{item.label}</span>
      </NavLink>
    </li>
  );

  return (
    <nav
      aria-label={strings.mainNavigation}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md supports-[backdrop-filter]:bg-background/75 lg:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch px-2">
        {primary.slice(0, split).map(tab)}
        <li className="flex flex-1 items-center justify-center">
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
        </li>
        {primary.slice(split).map(tab)}
        <li className="flex flex-1">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={more.open}
            className={tabClass(more.active || more.open)}
            onClick={() => more.setOpen(true)}
          >
            <Ellipsis aria-hidden className="size-[22px]" strokeWidth={1.9} />
            <span>{strings.more}</span>
          </button>
        </li>
      </ul>
      <MoreSheet items={secondary} open={more.open} onOpenChange={more.setOpen} />
    </nav>
  );
}

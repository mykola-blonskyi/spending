import { Ellipsis } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import { focusRing, isEnd, MAIN_ID, type NavItem, type ShellProps, splitNav, useMore } from './nav';
import { MoreSheet, SkipLink } from './shell-primitives';

const railButton = (active: boolean) =>
  cn(
    'flex size-10 items-center justify-center rounded-xl transition-colors duration-150',
    active
      ? 'bg-accent text-accent-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    focusRing,
  );

const slotClass = (active: boolean) =>
  cn(
    'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] leading-none font-medium transition-colors duration-150',
    active ? 'text-foreground' : 'text-muted-foreground',
    focusRing,
  );

const slotIcon = (active: boolean) =>
  cn(
    'flex h-7 w-11 items-center justify-center rounded-lg transition-colors duration-150',
    active && 'bg-accent text-accent-foreground',
  );

/** Bento: an icon rail with tooltips on desktop, a bottom bar with a square add button on mobile. */
export function BentoShell({
  brand,
  brandMark,
  navItems,
  primaryAction,
  status,
  banner,
  children,
}: ShellProps) {
  const { strings } = useSharedLocale();
  const { primary, secondary } = splitNav(navItems);
  const more = useMore(secondary);

  const slot = (item: NavItem) => (
    <li key={item.to} className="flex flex-1">
      <NavLink to={item.to} end={isEnd(item.to)} className={({ isActive }) => slotClass(isActive)}>
        {({ isActive }) => (
          <>
            <span className={slotIcon(isActive)}>
              <item.icon aria-hidden className="size-5" strokeWidth={1.9} />
            </span>
            <span className="max-w-full truncate px-0.5">{item.label}</span>
          </>
        )}
      </NavLink>
    </li>
  );

  return (
    <div className="min-h-dvh bg-background">
      <SkipLink />

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-14 flex-col items-center border-r bg-card py-3 lg:flex">
        {brandMark ?? brand}
        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink
              to={primaryAction.to}
              aria-label={primaryAction.label}
              className={cn(
                'mt-4 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform duration-150 ease-out active:scale-[0.95]',
                focusRing,
              )}
            >
              <primaryAction.icon aria-hidden className="size-[18px]" strokeWidth={2.3} />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent side="right">{primaryAction.label}</TooltipContent>
        </Tooltip>
        <span aria-hidden className="my-3 h-px w-6 bg-border" />
        <nav aria-label={strings.mainNavigation} className="flex-1 overflow-y-auto">
          <ul className="flex flex-col gap-1">
            {navItems.map((item) => (
              <li key={item.to}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <NavLink
                      to={item.to}
                      end={isEnd(item.to)}
                      aria-label={item.label}
                      className={({ isActive }) => railButton(isActive)}
                    >
                      <item.icon aria-hidden className="size-[18px]" strokeWidth={1.9} />
                    </NavLink>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="flex min-h-dvh flex-col lg:pl-14">
        <header className="sticky top-0 z-30 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between gap-3 px-4 lg:justify-end lg:px-8">
            <div className="lg:hidden">{brand}</div>
            {status}
          </div>
          {banner}
        </header>

        <main
          id={MAIN_ID}
          tabIndex={-1}
          className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none lg:px-8 lg:pt-6 lg:pb-8"
        >
          {children}
        </main>
      </div>

      <nav
        aria-label={strings.mainNavigation}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch gap-1 px-2 py-1">
          {primary.slice(0, 2).map(slot)}
          <li className="flex flex-1 items-center justify-center">
            <NavLink
              to={primaryAction.to}
              aria-label={primaryAction.label}
              className={cn(
                'flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform duration-150 ease-out active:scale-[0.94]',
                focusRing,
              )}
            >
              <primaryAction.icon aria-hidden className="size-6" strokeWidth={2.2} />
            </NavLink>
          </li>
          {primary.slice(2).map(slot)}
          <li className="flex flex-1">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={more.open}
              className={slotClass(more.active || more.open)}
              onClick={() => more.setOpen(true)}
            >
              <span className={slotIcon(more.active || more.open)}>
                <Ellipsis aria-hidden className="size-5" strokeWidth={1.9} />
              </span>
              <span>{strings.more}</span>
            </button>
          </li>
        </ul>
        <MoreSheet items={secondary} open={more.open} onOpenChange={more.setOpen} />
      </nav>
    </div>
  );
}

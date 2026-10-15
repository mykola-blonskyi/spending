import type { LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/ui/tooltip';
import { focusRing, isEnd, MAIN_ID, type ShellProps, splitNav } from './nav';
import { MobileTabBar, SkipLink } from './shell-primitives';

// A static string: the tooltip's Slot would stringify a className function.
const railButton = cn(
  'flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground',
  focusRing,
);

const slotClass = (active: boolean) =>
  cn(
    'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] leading-none font-medium transition-colors duration-150',
    active ? 'text-foreground' : 'text-muted-foreground',
    focusRing,
  );

const slotIcon = (Icon: LucideIcon, active: boolean) => (
  <span
    className={cn(
      'flex h-7 w-11 items-center justify-center rounded-lg transition-colors duration-150',
      active && 'bg-accent text-accent-foreground',
    )}
  >
    <Icon aria-hidden className="size-5" strokeWidth={1.9} />
  </span>
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
                      className={railButton}
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

      <MobileTabBar
        primary={primary}
        secondary={secondary}
        tabClass={slotClass}
        icon={slotIcon}
        className="fixed inset-x-0 bottom-0 z-40 bg-card lg:hidden"
        listClassName="gap-1 py-1"
        add={
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
        }
      />
    </div>
  );
}

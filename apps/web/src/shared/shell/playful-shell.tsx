import { Ellipsis, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { focusRing, isEnd, MAIN_ID, type ShellProps, splitNav, useMore } from './nav';
import { MobileTabBar, MoreMenu, SkipLink } from './shell-primitives';

const topPill = (active: boolean) =>
  cn(
    'flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors duration-150',
    active
      ? 'bg-foreground text-background'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    focusRing,
  );

const tabClass = (active: boolean) =>
  cn(
    'flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] leading-none font-semibold transition-colors duration-150',
    active ? 'text-primary' : 'text-muted-foreground',
    focusRing,
  );

const tabIcon = (Icon: LucideIcon, active: boolean) => (
  <Icon aria-hidden className="size-[22px]" strokeWidth={active ? 2.2 : 1.9} />
);

/** Playful but restrained: a dotted canvas, sticker-like pills and a big ringed add button. */
export function PlayfulShell({
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

  return (
    <div className="min-h-dvh bg-background bg-[radial-gradient(circle,var(--border)_1.1px,transparent_1.3px)] bg-[size:16px_16px] bg-[position:8px_8px]">
      <SkipLink />

      <header className="sticky top-0 z-30 border-b bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6 lg:hidden">
          {brand}
          {status}
        </div>
        <div className="mx-auto hidden h-16 max-w-5xl items-center gap-6 px-10 lg:flex">
          {brand}
          <nav aria-label={strings.mainNavigation} className="flex-1">
            <ul className="flex items-center gap-1">
              {primary.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={isEnd(item.to)}
                    className={({ isActive }) => topPill(isActive)}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
              <li>
                <MoreMenu
                  items={secondary}
                  trigger={
                    <button type="button" className={topPill(more.active)}>
                      <Ellipsis aria-hidden className="size-4" strokeWidth={2} />
                      {strings.more}
                    </button>
                  }
                />
              </li>
            </ul>
          </nav>
          <NavLink
            to={primaryAction.to}
            className={cn(
              'flex h-10 items-center gap-2 rounded-full bg-primary pr-4 pl-3 text-sm font-semibold whitespace-nowrap text-primary-foreground ring-4 ring-primary/15 transition-transform duration-150 ease-out active:scale-[0.97]',
              focusRing,
            )}
          >
            <primaryAction.icon aria-hidden className="size-4" strokeWidth={2.4} />
            {primaryAction.label}
          </NavLink>
          {status}
        </div>
        {banner}
      </header>

      <main
        id={MAIN_ID}
        tabIndex={-1}
        className="@container/main mx-auto w-full max-w-5xl px-4 pt-6 pb-[calc(8rem+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-10 lg:pt-10 lg:pb-16"
      >
        {children}
      </main>

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
              '-mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground ring-[6px] ring-primary/15 transition-transform duration-150 ease-out active:scale-[0.94]',
              focusRing,
            )}
          >
            <primaryAction.icon aria-hidden className="size-7" strokeWidth={2.4} />
          </NavLink>
        }
      />
    </div>
  );
}

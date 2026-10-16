import { Ellipsis } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { focusRing, isEnd, MAIN_ID, type ShellProps, splitNav, useMore } from './nav';
import { MoreMenu, MoreSheet, SkipLink } from './shell-primitives';

const segment = (active: boolean) =>
  cn(
    'relative flex h-11 w-full items-center justify-center gap-1.5 text-sm transition-colors duration-150 lg:h-14',
    active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
    focusRing,
  );

const underline = (
  <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
);

/** Timeline / journal: a quiet 640px column under one segmented navigation. */
export function JournalShell({
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

  const segments = (
    <ul className="flex gap-3 lg:gap-6">
      {primary.map((item) => (
        <li key={item.to} className="flex-1 lg:flex-none">
          <NavLink
            to={item.to}
            end={isEnd(item.to)}
            className={({ isActive }) => segment(isActive)}
          >
            {({ isActive }) => (
              <>
                {item.label}
                {isActive && underline}
              </>
            )}
          </NavLink>
        </li>
      ))}
      <li className="flex-1 lg:flex-none">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={more.open}
          className={cn(segment(more.active || more.open), 'lg:hidden')}
          onClick={() => more.setOpen(true)}
        >
          <Ellipsis aria-hidden className="size-4" strokeWidth={1.8} />
          {strings.more}
          {more.active && underline}
        </button>
        <MoreMenu
          items={secondary}
          trigger={
            <button type="button" className={cn(segment(more.active), 'hidden px-1 lg:flex')}>
              <Ellipsis aria-hidden className="size-4" strokeWidth={1.8} />
              {strings.more}
              {more.active && underline}
            </button>
          }
        />
      </li>
    </ul>
  );

  return (
    <div className="min-h-dvh bg-background">
      <SkipLink />

      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col px-8 pt-10 lg:flex">
        {brand}
      </aside>

      <div className="flex min-h-dvh flex-col lg:pl-56">
        <header className="sticky top-0 z-30 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="flex h-14 items-center justify-between gap-3 px-4 lg:hidden">
            {brand}
            <div className="flex min-w-0 items-center gap-1">
              <NavLink
                to={primaryAction.to}
                aria-label={primaryAction.label}
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-full text-primary transition-colors duration-150 hover:bg-accent',
                  focusRing,
                )}
              >
                <primaryAction.icon aria-hidden className="size-6" strokeWidth={1.8} />
              </NavLink>
              {status}
            </div>
          </div>
          <div className="mx-auto flex max-w-[640px] items-center justify-between gap-6 border-b px-4 lg:px-0 lg:pt-3">
            <nav aria-label={strings.mainNavigation} className="flex-1">
              {segments}
            </nav>
            <div className="hidden items-center gap-3 lg:flex">
              <NavLink
                to={primaryAction.to}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium whitespace-nowrap text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.97]',
                  focusRing,
                )}
              >
                <primaryAction.icon aria-hidden className="size-4" strokeWidth={2} />
                {primaryAction.label}
              </NavLink>
              {status}
            </div>
          </div>
          {banner}
        </header>

        <main
          id={MAIN_ID}
          tabIndex={-1}
          className="@container/main mx-auto w-full max-w-[640px] flex-1 px-4 pt-6 pb-20 outline-none lg:px-0 lg:pt-10 [&_h1]:font-serif [&_h1]:tracking-[-0.005em]"
        >
          {children}
        </main>
      </div>
      <MoreSheet items={secondary} open={more.open} onOpenChange={more.setOpen} />
    </div>
  );
}

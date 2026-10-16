import { Ellipsis } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { focusRing, isEnd, MAIN_ID, type NavItem, type ShellProps, splitNav, useMore } from './nav';
import { MoreMenu, MoreSheet, SkipLink } from './shell-primitives';

const floatShadow =
  'shadow-[0_2px_6px_color-mix(in_oklch,var(--foreground)_6%,transparent),0_16px_40px_-12px_color-mix(in_oklch,var(--foreground)_22%,transparent)] dark:shadow-[0_0_0_1px_var(--border)]';
const cardShadow =
  'shadow-[0_1px_2px_color-mix(in_oklch,var(--foreground)_4%,transparent),0_12px_32px_-16px_color-mix(in_oklch,var(--foreground)_14%,transparent)] dark:shadow-none';

const topPill = (active: boolean) =>
  cn(
    'flex h-11 items-center gap-2 rounded-full px-4 text-[15px] font-medium transition-colors duration-150',
    active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
    focusRing,
  );

/** Soft rounded friendly: pill navigation at the top on desktop, a floating pill bar on mobile. */
export function SoftShell({
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
    <div className="min-h-dvh bg-muted text-base leading-relaxed dark:bg-background">
      <SkipLink />
      <header className="sticky top-0 z-30 bg-muted/90 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:bg-background/90">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:hidden">
          {brand}
          {status}
        </div>
        <div className="mx-auto hidden h-20 max-w-6xl items-center gap-6 px-8 lg:flex">
          {brand}
          <nav
            aria-label={strings.mainNavigation}
            className={cn('flex items-center gap-1 rounded-full bg-card p-1.5', cardShadow)}
          >
            {primary.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={isEnd(item.to)}
                className={({ isActive }) => topPill(isActive)}
              >
                <item.icon aria-hidden className="size-[18px]" strokeWidth={2} />
                {item.label}
              </NavLink>
            ))}
            <MoreMenu
              items={secondary}
              trigger={
                <button type="button" className={topPill(more.active)}>
                  <Ellipsis aria-hidden className="size-[18px]" strokeWidth={2} />
                  {strings.more}
                </button>
              }
            />
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <NavLink
              to={primaryAction.to}
              className={cn(
                'flex h-12 items-center gap-2 rounded-full bg-primary pr-6 pl-5 text-[15px] font-semibold whitespace-nowrap text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.97]',
                focusRing,
              )}
            >
              <primaryAction.icon aria-hidden className="size-5" strokeWidth={2.4} />
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
        className="@container/main mx-auto max-w-6xl px-4 pt-6 pb-[calc(9rem+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-8 lg:pt-10 lg:pb-16"
      >
        {children}
      </main>

      <nav
        aria-label={strings.mainNavigation}
        className={cn(
          'fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto flex h-[4.25rem] max-w-md items-center justify-between rounded-full bg-card px-2 lg:hidden',
          floatShadow,
        )}
      >
        {primary.slice(0, 2).map((item) => (
          <PillTab key={item.to} item={item} />
        ))}
        <NavLink
          to={primaryAction.to}
          aria-label={primaryAction.label}
          className={cn(
            'flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.94]',
            focusRing,
          )}
        >
          <primaryAction.icon aria-hidden className="size-6" strokeWidth={2.4} />
        </NavLink>
        {primary.slice(2).map((item) => (
          <PillTab key={item.to} item={item} />
        ))}
        <button
          type="button"
          aria-label={strings.more}
          aria-haspopup="dialog"
          aria-expanded={more.open}
          className={pillTab(more.active || more.open)}
          onClick={() => more.setOpen(true)}
        >
          <Ellipsis aria-hidden className="size-[22px]" strokeWidth={2} />
        </button>
        <MoreSheet items={secondary} open={more.open} onOpenChange={more.setOpen} />
      </nav>
    </div>
  );
}

const pillTab = (active: boolean) =>
  cn(
    'flex size-12 shrink-0 items-center justify-center rounded-full transition-colors duration-150',
    active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
    focusRing,
  );

/** Icon only: four labels do not fit a 390px pill bar in every language. */
function PillTab({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={isEnd(item.to)}
      aria-label={item.label}
      className={({ isActive }) => pillTab(isActive)}
    >
      <item.icon aria-hidden className="size-[22px]" strokeWidth={2} />
    </NavLink>
  );
}

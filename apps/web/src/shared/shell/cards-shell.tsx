import { Ellipsis } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import { focusRing, isEnd, MAIN_ID, type ShellProps, splitNav, useMore } from './nav';
import { MoreSheet, SkipLink } from './shell-primitives';

const tabClass = (active: boolean) =>
  cn(
    'flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] leading-none font-medium transition-colors duration-150',
    active ? 'text-primary' : 'text-muted-foreground',
    focusRing,
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
  const { strings } = useSharedLocale();
  const { primary, secondary } = splitNav(navItems);
  const more = useMore(secondary);

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
        <NavLink
          to={primaryAction.to}
          className={cn(
            'absolute right-4 bottom-[calc(100%+12px)] flex h-14 items-center gap-2 rounded-2xl bg-primary pr-5 pl-4 text-[15px] font-semibold whitespace-nowrap text-primary-foreground shadow-[0_10px_24px_-10px_var(--primary)] transition-transform duration-150 ease-out active:scale-[0.96]',
            focusRing,
          )}
        >
          <primaryAction.icon aria-hidden className="size-5" strokeWidth={2.4} />
          {primaryAction.label}
        </NavLink>
        <nav
          aria-label={strings.mainNavigation}
          className="border-t bg-card pb-[env(safe-area-inset-bottom)] lg:border-x"
        >
          <ul className="flex px-2">
            {primary.map((item) => (
              <li key={item.to} className="flex flex-1">
                <NavLink
                  to={item.to}
                  end={isEnd(item.to)}
                  className={({ isActive }) => tabClass(isActive)}
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        aria-hidden
                        className="size-6"
                        strokeWidth={isActive ? 2.2 : 1.8}
                      />
                      <span className="max-w-full truncate px-0.5">{item.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
            <li className="flex flex-1">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={more.open}
                className={tabClass(more.active || more.open)}
                onClick={() => more.setOpen(true)}
              >
                <Ellipsis aria-hidden className="size-6" strokeWidth={1.8} />
                <span>{strings.more}</span>
              </button>
            </li>
          </ul>
          <MoreSheet items={secondary} open={more.open} onOpenChange={more.setOpen} />
        </nav>
      </div>
    </div>
  );
}

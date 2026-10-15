import { Ellipsis, type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router';
import { useSharedLocale } from '@shared/lib/locale-context';
import { cn } from '@shared/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@shared/ui/sheet';
import { focusRing, isEnd, MAIN_ID, type NavItem, useMore } from './nav';

export function SkipLink() {
  const { strings } = useSharedLocale();
  return (
    <a
      href={`#${MAIN_ID}`}
      className={cn(
        'fixed top-2 left-2 z-50 -translate-y-16 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus-visible:translate-y-0',
        focusRing,
      )}
    >
      {strings.skipToContent}
    </a>
  );
}

/** The mobile "More" destination list, as a bottom sheet. */
export function MoreSheet({
  items,
  open,
  onOpenChange,
}: {
  items: readonly NavItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { strings } = useSharedLocale();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <SheetHeader>
          <SheetTitle>{strings.moreTitle}</SheetTitle>
        </SheetHeader>
        <ul className="grid grid-cols-3 gap-2 px-4">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={() => onOpenChange(false)}
                className={({ isActive }) =>
                  cn(
                    'flex h-20 flex-col items-center justify-center gap-2 rounded-xl border text-xs font-medium transition-colors duration-150',
                    isActive
                      ? 'border-primary/30 bg-accent text-accent-foreground'
                      : 'bg-card text-foreground hover:bg-muted',
                    focusRing,
                  )
                }
              >
                <item.icon aria-hidden className="size-5" strokeWidth={1.9} />
                <span className="max-w-full truncate px-1">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

/** The desktop "More" destination list, as a menu under its trigger. */
export function MoreMenu({
  items,
  trigger,
}: {
  items: readonly NavItem[];
  trigger: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {items.map((item) => (
          <DropdownMenuItem key={item.to} asChild>
            <NavLink to={item.to} className="aria-[current=page]:bg-accent">
              <item.icon aria-hidden strokeWidth={1.9} />
              {item.label}
            </NavLink>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A desktop sidebar's destination list; `itemClass` sets each link's size, icon size and shape. */
export function SidebarList({
  items,
  itemClass,
  className,
}: {
  items: readonly NavItem[];
  itemClass: string;
  className?: string;
}) {
  return (
    <ul className={cn('flex flex-col', className)}>
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={isEnd(item.to)}
            className={({ isActive }) =>
              cn(
                'flex items-center font-medium transition-colors duration-150',
                itemClass,
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                focusRing,
              )
            }
          >
            <item.icon aria-hidden strokeWidth={1.9} />
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * The phone tab bar: the primary destinations, an optional add button between the first two and
 * the rest, and a "More" tab that opens the secondary destinations as a sheet.
 */
export function MobileTabBar({
  primary,
  secondary,
  tabClass,
  icon,
  add,
  className,
  listClassName,
}: {
  primary: readonly NavItem[];
  secondary: readonly NavItem[];
  tabClass: (active: boolean) => string;
  icon: (Icon: LucideIcon, active: boolean) => React.ReactNode;
  add?: React.ReactNode;
  className?: string;
  listClassName?: string;
}) {
  const { strings } = useSharedLocale();
  const more = useMore(secondary);

  const tab = (item: NavItem) => (
    <li key={item.to} className="flex flex-1">
      <NavLink to={item.to} end={isEnd(item.to)} className={({ isActive }) => tabClass(isActive)}>
        {({ isActive }) => (
          <>
            {icon(item.icon, isActive)}
            <span className="max-w-full truncate px-0.5">{item.label}</span>
          </>
        )}
      </NavLink>
    </li>
  );

  return (
    <nav
      aria-label={strings.mainNavigation}
      className={cn('border-t pb-[env(safe-area-inset-bottom)]', className)}
    >
      <ul className={cn('mx-auto flex max-w-lg px-2', listClassName)}>
        {add ? (
          <>
            {primary.slice(0, 2).map(tab)}
            <li className="flex flex-1 items-center justify-center">{add}</li>
            {primary.slice(2).map(tab)}
          </>
        ) : (
          primary.map(tab)
        )}
        <li className="flex flex-1">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={more.open}
            className={tabClass(more.active || more.open)}
            onClick={() => more.setOpen(true)}
          >
            {icon(Ellipsis, more.active || more.open)}
            <span>{strings.more}</span>
          </button>
        </li>
      </ul>
      <MoreSheet items={secondary} open={more.open} onOpenChange={more.setOpen} />
    </nav>
  );
}

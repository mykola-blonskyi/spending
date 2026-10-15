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
import { focusRing, MAIN_ID, type NavItem } from './nav';

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

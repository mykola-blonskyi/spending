import { LogOut, Settings } from 'lucide-react';
import { Link } from 'react-router';
import { useSignOut } from '@features/auth';
import { useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { UserAvatar } from '@shared/components';
import { cn } from '@shared/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/ui/dropdown-menu';

export function UserMenu({ showName = true }: { showName?: boolean }) {
  const t = useTranslations();
  const profile = useProfile();
  const signOut = useSignOut();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('userMenu.label', { name: profile.displayName })}
          className={cn(
            'flex h-10 max-w-56 items-center gap-2 rounded-full p-1 transition-colors duration-150 outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/60',
            showName && 'sm:pr-3',
          )}
        >
          <UserAvatar user={profile} />
          {showName && (
            <span className="hidden truncate text-sm font-medium sm:inline">
              {profile.displayName}
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
            <span className="truncate font-medium">{profile.displayName}</span>
            <span className="truncate text-xs text-muted-foreground">{profile.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/settings">
              <Settings aria-hidden />
              {t('nav.settings')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={signOut.busy} onSelect={signOut.request}>
            <LogOut aria-hidden />
            {t('actions.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {signOut.dialog}
    </>
  );
}

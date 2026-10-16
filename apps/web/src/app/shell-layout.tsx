import { Plus } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { useSyncStatus } from '@data/sync';
import { useApplyProfilePreferences, useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { OfflineBanner, SyncStatusBadge } from '@shared/components';
import { useOnlineStatus } from '@shared/lib/network';
import { type NavItem } from '@shared/shell';
import { Brand, BrandMark } from './brand';
import { ADD_TRANSACTION_PATH, DESTINATIONS } from './destinations';
import { LAYOUTS } from './layouts/registry';
import { UserMenu } from './user-menu';

export function ShellLayout() {
  const t = useTranslations();
  const online = useOnlineStatus();
  const syncStatus = useSyncStatus();
  useApplyProfilePreferences();
  const { layout } = useProfile();
  const Shell = LAYOUTS[layout].shell;
  // Journal's header shares its row with the add button (and the nav on desktop); the card stack
  // is a phone-width column at every screen size.
  const crowdedHeader = layout === 'journal';
  const narrowHeader = crowdedHeader || layout === 'cards';
  const navItems: NavItem[] = DESTINATIONS.map((destination) => ({
    to: destination.path,
    label: t(`nav.${destination.nav}`),
    icon: destination.icon,
    placement: destination.placement,
  }));

  return (
    <div data-layout={layout} className="contents">
      <Shell
        brand={<Brand name={t('app.name')} />}
        brandMark={
          <Link
            to="/"
            aria-label={t('app.name')}
            className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            <BrandMark className="size-9" />
          </Link>
        }
        navItems={navItems}
        primaryAction={{ to: ADD_TRANSACTION_PATH, label: t('nav.addTransaction'), icon: Plus }}
        status={
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to="/sync"
              className="min-w-0 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
            >
              {syncStatus && <SyncStatusBadge status={syncStatus} compact={crowdedHeader} />}
            </Link>
            <UserMenu showName={!narrowHeader} />
          </div>
        }
        banner={online ? undefined : <OfflineBanner />}
      >
        <Outlet />
      </Shell>
    </div>
  );
}

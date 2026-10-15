import { Lock, Plus } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { useReadOnlyTab, useSyncStatus } from '@data/sync';
import { useApplyProfilePreferences, useProfile } from '@features/profile';
import { useTranslations } from '@i18n/index';
import { OfflineBanner, StatusBanner, SyncStatusBadge } from '@shared/components';
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
  const readOnly = useReadOnlyTab();
  useApplyProfilePreferences();
  const { layout } = useProfile();
  const Shell = LAYOUTS[layout].shell;
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
          <div className="flex items-center gap-2">
            <Link
              to="/sync"
              className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
            >
              {syncStatus && <SyncStatusBadge status={syncStatus} />}
            </Link>
            <UserMenu />
          </div>
        }
        banner={
          <>
            {readOnly && (
              <StatusBanner
                icon={Lock}
                title={t('states.readOnlyTab.title')}
                description={t('states.readOnlyTab.description')}
              />
            )}
            {!online && <OfflineBanner />}
          </>
        }
      >
        <Outlet />
      </Shell>
    </div>
  );
}

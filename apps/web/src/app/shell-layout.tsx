import { Plus } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { useTranslations } from '@i18n/index';
import { OfflineBanner, SyncStatusBadge } from '@shared/components';
import { useOnlineStatus } from '@shared/lib/network';
import { AppShell, type NavItem } from '@shared/shell';
import { Brand } from './brand';
import { ADD_TRANSACTION_PATH, DESTINATIONS } from './destinations';

export function ShellLayout() {
  const t = useTranslations();
  const online = useOnlineStatus();
  const navItems: NavItem[] = DESTINATIONS.map((destination) => ({
    to: destination.path,
    label: t(`nav.${destination.nav}`),
    icon: destination.icon,
    placement: destination.placement,
  }));

  return (
    <AppShell
      brand={<Brand name={t('app.name')} />}
      navItems={navItems}
      primaryAction={{ to: ADD_TRANSACTION_PATH, label: t('nav.addTransaction'), icon: Plus }}
      status={
        <Link
          to="/sync"
          className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
        >
          <SyncStatusBadge status={{ state: 'synced' }} />
        </Link>
      }
      banner={online ? undefined : <OfflineBanner />}
    >
      <Outlet />
    </AppShell>
  );
}

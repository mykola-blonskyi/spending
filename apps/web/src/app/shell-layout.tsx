import { Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslations } from '@i18n/index';
import { OfflineBanner, SyncStatusBadge } from '@shared/components';
import { useOnlineStatus } from '@shared/lib/network';
import { AppShell, type NavItem } from '@shared/shell';
import { Brand } from './brand';
import { ADD_TRANSACTION_PATH, DESTINATIONS } from './destinations';

/** The page's own heading names the document, so titles stay translated and in one place. */
function pageHeadingText(): string | undefined {
  const heading = document.querySelector('#main h1') ?? document.querySelector('#main h2');
  return heading?.textContent?.trim() || undefined;
}

export function ShellLayout() {
  const t = useTranslations();
  const { pathname } = useLocation();
  const lastPathname = useRef(pathname);
  const online = useOnlineStatus();
  const navItems: NavItem[] = DESTINATIONS.map((destination) => ({
    to: destination.path,
    label: t(`nav.${destination.nav}`),
    icon: destination.icon,
    placement: destination.placement,
  }));

  // Runs after every render so a language switch retitles the document too.
  useEffect(() => {
    const heading = pageHeadingText();
    document.title = heading ? `${heading} · ${t('app.name')}` : t('app.name');
  });

  // Screen readers get no page load on client-side navigation: move focus to the new content.
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);

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

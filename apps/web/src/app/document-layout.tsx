import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useTranslations } from '@i18n/index';

/** The page's own heading names the document, so titles stay translated and in one place. */
function pageHeadingText(): string | undefined {
  const heading = document.querySelector('main h1') ?? document.querySelector('main h2');
  return heading?.textContent?.trim() || undefined;
}

/** Wraps every route, inside or outside the shell, so title and focus never go stale. */
export function DocumentLayout() {
  const t = useTranslations();
  const { pathname } = useLocation();
  const lastPathname = useRef(pathname);

  // Runs after every render so a language switch retitles the document too.
  useEffect(() => {
    const heading = pageHeadingText();
    document.title = heading ? `${heading} · ${t('app.name')}` : t('app.name');
  });

  // Screen readers get no page load on client-side navigation: move focus to the new content.
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    const main = document.querySelector<HTMLElement>('main');
    if (!main) return;
    if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
    main.focus({ preventScroll: true });
  }, [pathname]);

  return <Outlet />;
}

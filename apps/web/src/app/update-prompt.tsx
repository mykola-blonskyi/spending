import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useTranslations } from '@i18n/index';

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Offers a new version once its service worker is installed and waiting. Only a click on Reload
 * activates it; a tab that did not click keeps running, with any unsaved input, until its own
 * user reloads.
 */
export function UpdatePrompt() {
  const t = useTranslations();
  const registration = useRef<ServiceWorkerRegistration>(undefined);
  const reloadRequested = useRef(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, swRegistration) {
      registration.current = swRegistration;
      // Browsers only check for a new version on navigation, which a long-lived SPA tab never does.
      if (swRegistration) setInterval(() => void swRegistration.update(), UPDATE_CHECK_MS);
    },
    onNeedReload() {
      if (reloadRequested.current) window.location.reload();
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    toast(t('states.update.available'), {
      id: 'app-update',
      duration: Infinity,
      action: {
        label: t('states.update.reload'),
        onClick: () => {
          reloadRequested.current = true;
          // Another tab may already have activated the new version.
          if (registration.current?.waiting) void updateServiceWorker();
          else window.location.reload();
        },
      },
    });
  }, [needRefresh, t, updateServiceWorker]);

  return null;
}

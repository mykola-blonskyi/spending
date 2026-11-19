import { act, render } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitUpgradeRequired } from '@data/upgrade-events';
import { I18nProvider } from '@i18n/index';
import { UpdatePrompt } from './update-prompt';

const sw = vi.hoisted(() => ({
  needRefresh: false,
  updateServiceWorker: vi.fn(),
  registration: { waiting: null as object | null, update: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: vi.fn() }));
vi.mock('virtual:pwa-register/react', async () => {
  const { useEffect } = await import('react');
  return {
    useRegisterSW(options: {
      onRegisteredSW?: (url: string, registration: ServiceWorkerRegistration) => void;
    }) {
      useEffect(() => {
        options.onRegisteredSW?.('/sw.js', sw.registration as unknown as ServiceWorkerRegistration);
      }, [options]);
      return {
        needRefresh: [sw.needRefresh, vi.fn()],
        offlineReady: [false, vi.fn()],
        updateServiceWorker: sw.updateServiceWorker,
      };
    },
  };
});

const ui = () => (
  <I18nProvider locale="en">
    <UpdatePrompt />
  </I18nProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  sw.needRefresh = false;
  sw.registration.waiting = null;
});

describe('UpdatePrompt', () => {
  it('offers a new version and waits for the user', () => {
    sw.needRefresh = true;
    render(ui());

    expect(toast).toHaveBeenCalledOnce();
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('applies a waiting version at once when the server refuses this client', () => {
    sw.registration.waiting = {};
    render(ui());

    act(() => emitUpgradeRequired());

    expect(sw.updateServiceWorker).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();
  });

  it('fetches the new version, then applies it without asking', () => {
    const { rerender } = render(ui());

    act(() => emitUpgradeRequired());
    expect(sw.registration.update).toHaveBeenCalledOnce();
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();

    sw.needRefresh = true;
    rerender(ui());

    expect(sw.updateServiceWorker).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();
  });
});

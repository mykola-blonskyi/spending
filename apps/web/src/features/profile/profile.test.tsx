import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@data/api-error';
import { createQueryClient } from '@data/query-client';
import { meQuery, updateMe } from '@data/session';
import { testProfile, testSession } from '@data/testing';
import { I18nProvider, useLocaleStore } from '@i18n/index';
import { ThemeProvider } from '@shared/theme';
import { revertPatch, useApplyProfilePreferences, useUpdateProfile } from './profile';

vi.mock('@features/auth', () => ({ useSession: () => testSession() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock(import('@data/session'), async (importOriginal) => ({
  ...(await importOriginal()),
  updateMe: vi.fn(),
}));

function setup() {
  const client = createQueryClient();
  client.setQueryData(meQuery.queryKey, testProfile);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <I18nProvider locale="en">{children}</I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(
    () => {
      useApplyProfilePreferences();
      return useUpdateProfile();
    },
    { wrapper },
  );
  return { client, hook };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  useLocaleStore.getState().setLocale('en');
});

describe('revertPatch', () => {
  it('restores only the fields the failed patch still owns', () => {
    const previous = { ...testProfile, locale: 'en', theme: 'system' } as const;
    const current = { ...testProfile, locale: 'uk', theme: 'light' } as const;
    expect(revertPatch(current, previous, { locale: 'uk', theme: 'dark' })).toEqual({
      ...testProfile,
      locale: 'en',
      theme: 'light',
    });
  });
});

describe('useUpdateProfile', () => {
  it('applies the change at once and keeps the saved profile', async () => {
    vi.mocked(updateMe).mockResolvedValue({ ...testProfile, locale: 'uk' });
    const { client, hook } = setup();

    act(() => hook.result.current.mutate({ locale: 'uk' }));

    await waitFor(() => expect(useLocaleStore.getState().locale).toBe('uk'));
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(client.getQueryData(meQuery.queryKey)?.locale).toBe('uk');
    expect(vi.mocked(updateMe).mock.calls[0]?.[0]).toEqual({ locale: 'uk' });
  });

  it('rolls back and explains when saving fails', async () => {
    let fail: (error: unknown) => void = () => {};
    vi.mocked(updateMe).mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const { client, hook } = setup();

    act(() => hook.result.current.mutate({ locale: 'uk', theme: 'dark' }));
    await waitFor(() => expect(useLocaleStore.getState().locale).toBe('uk'));
    expect(document.documentElement).toHaveClass('dark');

    act(() => fail(new ApiError({ status: 503, code: 'UNAVAILABLE', message: 'x' })));

    await waitFor(() => expect(useLocaleStore.getState().locale).toBe('en'));
    expect(client.getQueryData(meQuery.queryKey)).toEqual(testProfile);
    expect(document.documentElement).not.toHaveClass('dark');
    expect(toast.error).toHaveBeenCalledWith(
      'The service is temporarily unavailable. Try again shortly.',
    );
  });

  it('leaves the explanation to sign-in when the session ended', async () => {
    vi.mocked(updateMe).mockRejectedValue(
      new ApiError({ status: 401, code: 'AUTH_REQUIRED', message: 'x', fromEnvelope: true }),
    );
    const { hook } = setup();
    act(() => hook.result.current.mutate({ theme: 'dark' }));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

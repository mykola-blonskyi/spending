import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { errorCode } from '@data/api-error';
import {
  isSignedOutError,
  meQuery,
  type Profile,
  type ProfilePatch,
  updateMe,
} from '@data/session';
import { useSession } from '@features/auth';
import { useLocaleStore, useTranslations } from '@i18n/index';
import { useTheme } from '@shared/theme';

const UPDATE_KEY = ['me', 'update'];

export function useProfile(): Profile {
  const { user } = useSession();
  return useQuery({ ...meQuery, initialData: user }).data;
}

/**
 * Undoes a failed patch field by field, leaving any field a later change has already
 * overwritten alone.
 */
export function revertPatch(current: Profile, previous: Profile, patch: ProfilePatch): Profile {
  const next = { ...current };
  for (const key of Object.keys(patch) as (keyof ProfilePatch)[]) {
    if (current[key] === patch[key]) Object.assign(next, { [key]: previous[key] });
  }
  return next;
}

/** Applies the change at once and saves it with PATCH /me; a failure rolls back and explains why. */
export function useUpdateProfile() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const key = meQuery.queryKey;

  return useMutation({
    mutationKey: UPDATE_KEY,
    mutationFn: updateMe,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      if (previous) queryClient.setQueryData(key, { ...previous, ...patch });
      return { previous };
    },
    onError: (error, patch, context) => {
      const previous = context?.previous;
      if (previous) {
        queryClient.setQueryData(
          key,
          (current) => current && revertPatch(current, previous, patch),
        );
      }
      if (!isSignedOutError(error)) toast.error(t(`errors.${errorCode(error)}`));
    },
    onSuccess: (profile) => {
      // An older response must not overwrite a newer optimistic value.
      if (queryClient.isMutating({ mutationKey: UPDATE_KEY }) === 1) {
        queryClient.setQueryData(key, profile);
      }
    },
  });
}

/**
 * While signed in, the profile is the source of truth for language and theme: the server's values
 * win on sign-in, and later changes go through `useUpdateProfile`. The device keeps the last
 * values, so the sign-in page matches after sign-out.
 */
export function useApplyProfilePreferences(): void {
  const { locale, theme } = useProfile();
  const setLocale = useLocaleStore((state) => state.setLocale);
  const { setPreference } = useTheme();

  useEffect(() => setLocale(locale), [locale, setLocale]);
  useEffect(() => setPreference(theme), [theme, setPreference]);
}

import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useSharedLocale } from '@shared/lib/locale-context';
import { errorCode } from './api-error';
import { isSignedOutError } from './session';

/** A refetch that fails while a list is on screen is told, not swapped for an error state. */
export function useRefetchErrorToast(query: UseQueryResult<unknown>): void {
  const { strings } = useSharedLocale();
  const toasted = useRef(0);
  const { isError, error, errorUpdatedAt, data, isPlaceholderData } = query;
  useEffect(() => {
    if (!isError || data === undefined || isPlaceholderData) return;
    if (toasted.current === errorUpdatedAt) return;
    toasted.current = errorUpdatedAt;
    if (!isSignedOutError(error)) toast.error(strings.apiError(errorCode(error)));
  }, [isError, error, errorUpdatedAt, data, isPlaceholderData, strings]);
}

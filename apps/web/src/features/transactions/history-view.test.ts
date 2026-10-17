import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_STORAGE_KEY, setHistoryView, useHistoryView } from './history-view';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('the history view choice', () => {
  it('starts as rows and keeps the choice on the device', () => {
    const first = renderHook(() => useHistoryView());
    expect(first.result.current).toBe('rows');
    act(() => setHistoryView('table'));
    expect(first.result.current).toBe('table');
    expect(JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)!)).toEqual({ view: 'table' });
    first.unmount();
    expect(renderHook(() => useHistoryView()).result.current).toBe('table');
  });

  it('falls back to rows for an unreadable stored value', () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, '{not json');
    expect(renderHook(() => useHistoryView()).result.current).toBe('rows');
  });

  // Last: the session keeps this choice in memory for the rest of the file.
  it('still switches for the session when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useHistoryView());
    expect(result.current).toBe('rows');
    act(() => setHistoryView('table'));
    expect(result.current).toBe('table');
  });
});

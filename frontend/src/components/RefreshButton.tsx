import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * Forces the server past its 60s quote cache and drops the result straight
 * into the `portfolio` query, so every screen reading it updates at once.
 *
 * `refresh=1` matters: without it the server re-serves the same cached
 * numbers and the button looks broken.
 *
 * Extracted from the Dashboard when the Stops page wanted the same control.
 * Both read the same query, so a second implementation would have been a
 * second chance for them to disagree about what "refreshed" means.
 */
export function RefreshButton({ label = 'Refresh prices now' }: { label?: string }) {
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      const fresh = await api<unknown>('/portfolio?refresh=1');
      queryClient.setQueryData(['portfolio'], fresh);
    } catch {
      // Leave the existing numbers on screen; the stale markers already warn.
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <button
      type="button"
      onClick={refreshNow}
      disabled={refreshing}
      aria-label={label}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface-1 text-base text-muted active:bg-surface-2 disabled:opacity-50"
    >
      <span className={refreshing ? 'inline-block animate-spin' : ''}>↻</span>
    </button>
  );
}

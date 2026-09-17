import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * The app's one spinning-circle refresh control. Defaults to forcing the
 * server past its 60s quote cache and dropping the result straight into the
 * `portfolio` query, so every screen reading it updates at once — that is
 * still all Dashboard and Stops need, and neither passes `onRefresh`.
 *
 * `refresh=1` matters on the default path: without it the server re-serves
 * the same cached numbers and the button looks broken.
 *
 * A caller with its own query (Watchlist) or its own refresh logic (Brief,
 * which guards against a late automatic refetch racing a forced one) passes
 * `onRefresh` and this button just owns the spin/disable state around it —
 * one visual idiom for "refreshing" instead of Brief's own text button that
 * looked and behaved differently from everywhere else in the app.
 */
export function RefreshButton({
  label = 'Refresh prices now',
  onRefresh,
}: {
  label?: string;
  onRefresh?: () => Promise<unknown>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const defaultRefresh = async () => {
    const fresh = await api<unknown>('/portfolio?refresh=1');
    queryClient.setQueryData(['portfolio'], fresh);
  };

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      await (onRefresh ?? defaultRefresh)();
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

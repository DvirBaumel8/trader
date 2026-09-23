import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api/client';
import { DAILY_BRIEF_QUERY_KEY, fetchDailyBrief } from '../api/dailyBrief';
import { Logo } from './Logo';

type Health = { status: string; database: string; userId: string | null };

/**
 * Silent when healthy, loud when broken. A permanent "everything is fine"
 * badge is noise the user learns to ignore; a bar that only appears on failure
 * is information.
 */
function ConnectionBanner() {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: () => api<Health>('/health/ping'),
    refetchInterval: 30_000,
    retry: 1,
  });

  if (isLoading) return null;
  if (!isError && data?.status === 'ok') return null;

  return (
    <div className="bg-down/15 px-4 py-2 text-center text-xs text-down">
      Can’t reach the server
    </div>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 border-b-2 px-2 py-2.5 text-xs transition-colors sm:px-3 sm:text-sm ${
    isActive
      ? 'border-accent text-text'
      : 'border-transparent text-muted hover:text-text'
  }`;

export function AppShell() {
  const queryClient = useQueryClient();

  // Fired once per app session, not on every route change or click — by the
  // time the owner actually taps Brief, its slowest part (the AI narrative
  // call) has often already finished, not just started. Shares Brief's own
  // staleTime so mounting the real query there does not immediately refetch
  // what this already just fetched.
  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: DAILY_BRIEF_QUERY_KEY,
      queryFn: () => fetchDailyBrief(),
      staleTime: 300_000,
    });
  }, [queryClient]);

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      <header className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <Logo className="h-6 w-6" />
        <span className="text-[19px] font-semibold tracking-tight">Trader</span>
      </header>

      <ConnectionBanner />

      {/*
        Only real destinations belong here. The dev-only ticker probe is
        deliberately absent and reachable by typing /probe — scaffolding should
        not take up space in the product's navigation.
      */}
      <nav className="flex justify-between border-b border-border px-2">
        <NavLink to="/" className={linkClass} end>
          Portfolio
        </NavLink>
        <NavLink to="/brief" className={linkClass}>
          Brief
        </NavLink>
        <NavLink to="/journal" className={linkClass}>
          Journal
        </NavLink>
        <NavLink to="/stops" className={linkClass}>
          Stops
        </NavLink>
        <NavLink to="/stocks" className={linkClass}>
          Trades
        </NavLink>
        <NavLink to="/watchlist" className={linkClass}>
          Watch
        </NavLink>
      </nav>

      <main className="flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
